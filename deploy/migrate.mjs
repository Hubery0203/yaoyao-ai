/** Explicit deployment migration entrypoint; privileged credentials never enter the API. */
import {Pool} from 'pg';
import {applyMigrations} from '@yaoyao/infrastructure';
const url=process.env.MIGRATION_DATABASE_URL,password=process.env.APP_DB_PASSWORD;
if(!url||!password||!/^[a-f0-9]{64}$/.test(password))throw new Error('Migration URL and a generated 32-byte hex application password are required');
const pool=new Pool({connectionString:url,max:1});
try{
 const result=await applyMigrations(pool,new URL('../db/migrations/',import.meta.url).pathname,'vps-deployment');
 await pool.query(`ALTER ROLE yaoyao_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
 console.log(JSON.stringify({applied:result.applied,alreadyApplied:result.alreadyApplied}));
}finally{await pool.end();}
