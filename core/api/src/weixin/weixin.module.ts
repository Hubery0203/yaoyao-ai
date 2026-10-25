import {Body,Controller,Get,HttpCode,HttpException,Inject,Module,Optional,Param,Post,Req} from '@nestjs/common';
import {WEIXIN_CHANNEL,type WeixinChannelPort,type WeixinExperiencePort,type OutreachSettings,validTimezone} from '@yaoyao/application';
import type {Request} from 'express';
import {z} from 'zod';
import {requirePrincipal} from '../auth/jwt-auth.guard.js';
import {ZodValidationPipe} from '../common/zod-validation.pipe.js';
@Controller('weixin')
class WeixinController {
 constructor(@Optional() @Inject(WEIXIN_CHANNEL) private readonly channel?:WeixinChannelPort){}
 @Get() async status(@Req() req:Request){const {userId}=requirePrincipal(req);return {data:this.channel?await this.channel.status(userId):{enabled:false}};}
 private available(){if(!this.channel)throw new HttpException('微信通道未启用',503);return this.channel;}
 private async safe<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch{throw new HttpException('微信通道暂不可用，或当前账号无权执行此操作。',409);}}
 private experience():WeixinExperiencePort {
  const channel=this.available() as Partial<WeixinExperiencePort>;
  if(!channel.settings||!channel.followup||!channel.cancelFollowup)throw new HttpException('微信体验设置尚不可用',503);
  return channel as WeixinExperiencePort;
 }
 @Post('outreach') @HttpCode(200) async outreach(@Req() req:Request,@Body(new ZodValidationPipe(z.object({enabled:z.boolean(),timezone:z.string().max(80).refine(validTimezone),quietStart:z.number().int().min(0).max(1439),quietEnd:z.number().int().min(0).max(1439),dailyLimit:z.union([z.literal(1),z.literal(2)]),greeting:z.boolean(),greetingMinute:z.number().int().min(0).max(1439)}).strict().refine(s=>s.quietStart!==s.quietEnd))) body:OutreachSettings){
  const {userId}=requirePrincipal(req);await this.safe(()=>this.experience().settings(userId,body));return {data:{ok:true}};
 }
 @Post('followups') @HttpCode(200) async followup(@Req() req:Request,@Body(new ZodValidationPipe(z.object({message:z.string().trim().min(1).max(120),dueAt:z.string().datetime({offset:true})}).strict())) body:{message:string;dueAt:string}){
  const {userId}=requirePrincipal(req);return {data:await this.safe(()=>this.experience().followup(userId,body.message,body.dueAt))};
 }
 @Post('followups/:id/cancel') @HttpCode(200) async cancel(@Req() req:Request,@Param('id') id:string){
  const {userId}=requirePrincipal(req);if(!z.string().uuid().safeParse(id).success)throw new HttpException('无效的事项标识',400);
  await this.safe(()=>this.experience().cancelFollowup(userId,id));return {data:{ok:true}};
 }
 @Post('binding-code') @HttpCode(200) async bind(@Req() req:Request){const {userId}=requirePrincipal(req);return {data:await this.safe(()=>this.available().bindingCode(userId))};}
 @Post('control') @HttpCode(200) async control(@Req() req:Request,@Body(new ZodValidationPipe(z.object({action:z.enum(['pause','resume'])}).strict())) body:{action:'pause'|'resume'}){
  const {userId}=requirePrincipal(req);await this.safe(()=>this.available().control(userId,body.action));return {data:{ok:true}};
 }
 @Post('deliveries/:key/resolve') @HttpCode(200) async resolve(@Req() req:Request,@Param('key') key:string,@Body(new ZodValidationPipe(z.object({action:z.enum(['confirm','retry','skip'])}).strict())) body:{action:'confirm'|'retry'|'skip'}){
  const {userId}=requirePrincipal(req);if(!/^[a-f0-9]{64}$/.test(key))throw new HttpException('无效的消息标识',400);
  await this.safe(()=>this.available().resolve(userId,key,body.action));return {data:{ok:true}};
 }
}
@Module({controllers:[WeixinController]})
export class WeixinModule {}
