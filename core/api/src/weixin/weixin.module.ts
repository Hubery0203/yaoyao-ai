import {Body,Controller,Get,HttpCode,HttpException,Inject,Module,Optional,Param,Post,Req} from '@nestjs/common';
import {WEIXIN_CHANNEL,type WeixinChannelPort} from '@yaoyao/application';
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
