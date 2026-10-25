import type {CompanionPreferences} from './experience.js';
export type CompanionCommand=
 |{type:'preferences'|'life'|'help'|'invalid'}
 |{type:'reset'}|{type:'patch';patch:Partial<CompanionPreferences>}
 |{type:'life-create';statement:string}|{type:'life-update';reference:string;statement:string}
 |{type:'confirm'|'cancel';kind:'preferences'|'life';code:string};
export function parseCompanionCommand(input:string):CompanionCommand|null{
 const t=input.trim();if(t==='设置列表'||t==='偏好设置')return {type:'preferences'};if(t==='近况列表')return {type:'life'};if(t==='设置帮助'||t==='近况帮助')return {type:'help'};
 let m=/^(确认|取消)(设置|近况)\s+([A-F0-9]{6})$/iu.exec(t);if(m)return {type:m[1]==='确认'?'confirm':'cancel',kind:m[2]==='设置'?'preferences':'life',code:m[3].toUpperCase()};
 if(t==='恢复默认设置')return {type:'reset'};
 if(t.length<=500&&!/[\r\n]/u.test(t)){
  m=/^设置(称呼|回复|亲昵|追问|建议|时区)[：:]\s*(.{1,80})$/u.exec(t);
  if(m){const value=m[2].trim();switch(m[1]){
   case '称呼':return {type:'patch',patch:{nickname:value==='不设置'?'':value}};
   case '时区':return {type:'patch',patch:{timezone:value}};
   case '回复':if(['简短','自然','详细'].includes(value))return {type:'patch',patch:{length:({'简短':'brief','自然':'balanced','详细':'detailed'}as const)[value as '简短'|'自然'|'详细']}};break;
   case '亲昵':if(['自然','克制'].includes(value))return {type:'patch',patch:{affection:value==='自然'?'warm':'reserved'}};break;
   case '追问':if(['少问','自然'].includes(value))return {type:'patch',patch:{questions:value==='少问'?'minimal':'natural'}};break;
   case '建议':if(['按需','自然'].includes(value))return {type:'patch',patch:{advice:value==='按需'?'on_request':'natural'}};break;
  }return {type:'invalid'};}
  if(/^(?:以后|今后)(?:回复|说话)?(?:请)?(?:简短一点|简短点|短一点|少说点)[。！!]?$/u.test(t))return {type:'patch',patch:{length:'brief'}};
  if(/^(?:以后|今后)(?:别|不要)(?:再)?追问(?:了)?[。！!]?$/u.test(t))return {type:'patch',patch:{questions:'minimal'}};
  if(/^(?:以后|今后)(?:别|不要)(?:再)?(?:给我|给)?建议(?:了)?[。！!]?$/u.test(t))return {type:'patch',patch:{advice:'on_request'}};
  m=/^(?:以后|今后)(?:就)?叫我([^。！!\n]{1,20})[。！!]?$/u.exec(t);if(m)return {type:'patch',patch:{nickname:m[1].trim()}};
  m=/^记录近况[：:]\s*(.{1,150})$/u.exec(t);if(m)return {type:'life-create',statement:m[1]};
  m=/^更新近况\s+([A-F0-9]{8})[：:]\s*(.{1,150})$/iu.exec(t);if(m)return {type:'life-update',reference:m[1].toUpperCase(),statement:m[2]};
 }
 return /^(?:设置(?:称呼|回复|亲昵|追问|建议|时区)[：:]|记录近况[：:]|更新近况\s|(?:确认|取消)(?:设置|近况)\s)/u.test(t)?{type:'invalid'}:null;
}
export const isCompanionCommandText=(text:string)=>parseCompanionCommand(text)!==null;
export const lifeReference=(id:string)=>id.replaceAll('-','').slice(-8).toUpperCase();
export type {PreferenceActionPayload,LifeActionPayload,CompanionAction,CompanionActionStore} from './experience.js';
