/** Read-only public-schema evidence. Hashes, counts and schema metadata only; never emits row text. */
import {createHash} from 'node:crypto';
export function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export async function databaseEvidence(query){
 const tables=await query(`SELECT coalesce(json_agg(x ORDER BY name COLLATE "C"),'[]'::json) FROM (SELECT c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')x`);
 if(!Array.isArray(tables)||tables.length>1000)throw Error('UNEXPECTED_SCHEMA');const contents=[];
 for(const t of tables){if(!/^[a-z_][a-z0-9_]*$/.test(t.name))throw Error('UNEXPECTED_TABLE_NAME');
  contents.push({name:t.name,...await query(`SELECT json_build_object('rows',count(*)::text,'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM public."${t.name}" t)x`)});
 }
 const columns=await query(`SELECT coalesce(json_agg(x ORDER BY table_name COLLATE "C",position),'[]'::json) FROM (SELECT c.relname table_name,a.attnum position,a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped)x`);
 const policies=await query(`SELECT coalesce(json_agg(x ORDER BY tablename COLLATE "C",policyname COLLATE "C"),'[]'::json) FROM (SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public')x`);
 const constraints=await query(`SELECT coalesce(json_agg(x ORDER BY table_name COLLATE "C",name COLLATE "C"),'[]'::json) FROM (SELECT c.relname table_name,p.conname name,pg_get_constraintdef(p.oid) definition,p.convalidated validated FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')x`);
 const indexes=await query(`SELECT coalesce(json_agg(x ORDER BY tablename COLLATE "C",indexname COLLATE "C"),'[]'::json) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public')x`);
 const grants=await query(`SELECT coalesce(json_agg(x ORDER BY table_name COLLATE "C",grantee COLLATE "C",privilege_type COLLATE "C"),'[]'::json) FROM (SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public')x`);
 const extensions=await query(`SELECT coalesce(json_agg(x ORDER BY name COLLATE "C"),'[]'::json) FROM (SELECT extname name,extversion version FROM pg_extension)x`);
 const sequenceDefinitions=await query(`SELECT coalesce(json_agg(x ORDER BY name COLLATE "C"),'[]'::json) FROM (SELECT sequencename name,sequenceowner owner,data_type,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname='public')x`);
 const metadata={tables,columns,policies,constraints,indexes,grants,extensions,sequenceDefinitions};return {extensionVersions:extensions,version:1,algorithm:'sha256-sorted-jsonb-row-hashes-v1',tableCount:tables.length,rows:contents.reduce((n,t)=>n+Number(t.rows),0),contents,metadataFingerprint:fingerprint(metadata),contentFingerprint:fingerprint(contents)};
}
export function compareEvidence(expected,actual){
 if(!expected||expected.version!==1||expected.algorithm!=='sha256-sorted-jsonb-row-hashes-v1'||!/^[a-f0-9]{64}$/.test(expected.contentFingerprint??'')||!/^[a-f0-9]{64}$/.test(expected.metadataFingerprint??''))throw Error('INVALID_SOURCE_EVIDENCE');
 if(expected.contentFingerprint!==actual.contentFingerprint)throw Error('RESTORED_CONTENT_MISMATCH');if(expected.metadataFingerprint!==actual.metadataFingerprint)throw Error('RESTORED_METADATA_MISMATCH');return true;
}

export async function validateSequenceFloors(query){
 const owned=await query(`SELECT coalesce(json_agg(x ORDER BY sequence_name COLLATE "C"),'[]'::json) FROM (SELECT s.relname sequence_name,t.relname table_name,a.attname column_name,q.seqincrement::text increment,q.seqcycle cycle FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence q ON q.seqrelid=s.oid JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE n.nspname='public' AND s.relkind='S')x`);
 for(const s of owned){if(![s.sequence_name,s.table_name,s.column_name].every(n=>/^[a-z_][a-z0-9_]*$/.test(n))||BigInt(s.increment)<=0n||s.cycle)throw Error('UNSUPPORTED_SEQUENCE_POLICY');
  const state=await query(`SELECT json_build_object('last',last_value::text,'called',is_called) FROM public."${s.sequence_name}"`),max=await query(`SELECT to_json(max("${s.column_name}")::text) FROM public."${s.table_name}"`);
  if(max!==null){const next=BigInt(state.last)+(state.called?BigInt(s.increment):0n);if(next<=BigInt(max))throw Error('RESTORED_SEQUENCE_BEHIND_DATA');}
 }return {safe:true,sequences:owned.length};
}

export function extensionBootstrap(versions){
 if(versions===undefined)return [];
 if(!Array.isArray(versions)||versions.length>30)throw Error('INVALID_EXTENSION_VERSIONS');const names=new Set();
 return versions.map(v=>{if(!v||typeof v.name!=='string'||!/^[a-z_][a-z0-9_]*$/.test(v.name)||typeof v.version!=='string'||!/^[0-9][a-zA-Z0-9_.-]{0,31}$/.test(v.version)||names.has(v.name))throw Error('INVALID_EXTENSION_VERSIONS');names.add(v.name);return `CREATE EXTENSION IF NOT EXISTS "${v.name}" VERSION '${v.version}';`;});
}
