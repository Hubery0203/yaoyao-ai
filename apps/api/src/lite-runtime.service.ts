/** Optional low-memory hosting profile; Core jobs remain database-authoritative. */
import {Inject,Injectable,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import {TRANSACTION_MANAGER,runContinuityOnce,type TransactionManager} from '@yaoyao/application';
import {type UserId} from '@yaoyao/domain';
import {loadConfig} from '@yaoyao/infrastructure';
@Injectable()
export class LiteRuntimeService implements OnModuleInit,OnModuleDestroy {
 private active=0;private working:Promise<void>|null=null;private timer:ReturnType<typeof setInterval>|undefined;private stopped=false;private index=0;
 private readonly config=loadConfig();
 private readonly owners=new Set(this.config.CONTINUITY_USER_IDS);
 registerOwner(userId:string):void {if(this.owners.size<100)this.owners.add(userId);}
 constructor(@Inject(TRANSACTION_MANAGER)private readonly tx:TransactionManager){}
 acquire():boolean {if(this.config.LITE_MODE!=='1')return true;if(this.active||this.working||this.stopped)return false;this.active++;return true;}
 release():void {if(this.config.LITE_MODE==='1')this.active=Math.max(0,this.active-1);}
 onModuleInit():void {if(this.config.LITE_MODE!=='1')return;this.timer=setInterval(()=>{if(this.stopped||this.active||this.working||!this.owners.size)return;const owners=[...this.owners];const owner=owners[this.index++%owners.length];this.working=runContinuityOnce(this.tx,owner as UserId).then(()=>undefined).catch(()=>{console.warn('Background continuity pass failed; will retry.');}).finally(()=>{this.working=null;});},30000);this.timer.unref();}
 async onModuleDestroy():Promise<void>{this.stopped=true;if(this.timer)clearInterval(this.timer);await this.working;}
}
