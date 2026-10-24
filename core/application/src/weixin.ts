export const WEIXIN_CHANNEL='YAOYAO_WEIXIN_CHANNEL';
export interface WeixinChannelPort {
 status(userId:string):Promise<unknown>;
 bindingCode(userId:string):Promise<{code:string;expiresAt:string}>;
 control(userId:string,action:'pause'|'resume'):Promise<void>;
 resolve(userId:string,key:string,action:'confirm'|'retry'|'skip'):Promise<void>;
}

export interface WeixinExperiencePort extends WeixinChannelPort {
 settings(userId:string,settings:import('./weixin-policy.js').OutreachSettings):Promise<void>;
 followup(userId:string,message:string,dueAt:string):Promise<{id:string}>;
 cancelFollowup(userId:string,id:string):Promise<void>;
}
