import {Body,Controller,Get,Headers,HttpCode,Inject,Module,Param,Post,Req,BadRequestException} from '@nestjs/common';
import {z} from 'zod';
import type {Request} from 'express';
import {TRANSACTION_MANAGER,updatePreferences,writeLifeFromSettings,experienceStore,lifeIsActive,validTimezone,type TransactionManager,type CompanionPreferences,type LifeChange} from '@yaoyao/application';
import {requirePrincipal} from '../auth/jwt-auth.guard.js';
import {ZodValidationPipe} from '../common/zod-validation.pipe.js';
const version=z.number().int().min(0).max(2147483647);
const preferences=z.object({nickname:z.string().trim().max(20).regex(/^[^\u0000-\u001f\u007f]*$/u),length:z.enum(['brief','balanced','detailed']),affection:z.enum(['warm','reserved']),questions:z.enum(['minimal','natural']),advice:z.enum(['on_request','natural']),timezone:z.string().max(80).refine(validTimezone)}).strict();
const change=z.object({subject:z.string().trim().min(1).max(50).regex(/^[^\u0000-\u001f\u007f]+$/u),state:z.enum(['planned','ongoing','completed','cancelled']),scheduledDay:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()}).strict();
function requestKey(key:string|undefined){if(!key||!/^[a-zA-Z0-9_-]{1,64}$/.test(key))throw new BadRequestException('需要有效的 Idempotency-Key');return key;}
@Controller('companion')
class CompanionController {
 constructor(@Inject(TRANSACTION_MANAGER)private readonly transactions:TransactionManager){}
 @Get('preferences') async read(@Req() req:Request){const {userId}=requirePrincipal(req);return {data:await this.transactions.runAsUser(userId,tx=>experienceStore(tx).preferences(userId))};}
 @Post('preferences') @HttpCode(200) async save(@Req() req:Request,@Body(new ZodValidationPipe(z.object({settings:preferences,expectedVersion:version}).strict())) body:{settings:CompanionPreferences;expectedVersion:number}){const {userId}=requirePrincipal(req);return {data:await this.transactions.runAsUser(userId,tx=>updatePreferences(tx,userId,body.settings,body.expectedVersion))};}
 @Get('life-events') async life(@Req() req:Request){const {userId}=requirePrincipal(req);return {data:await this.transactions.runAsUser(userId,async tx=>{const store=experienceStore(tx),p=await store.preferences(userId),now=new Date();return {events:(await store.lifeEvents(userId,100)).map(e=>({...e,active:lifeIsActive(e,now,p.settings.timezone)})),timezone:p.settings.timezone};})};}
 @Post('life-events') @HttpCode(200) async create(@Req() req:Request,@Headers('idempotency-key') key:string|undefined,@Body(new ZodValidationPipe(change)) body:LifeChange){const {userId}=requirePrincipal(req);return {data:await this.transactions.runAsUser(userId,tx=>writeLifeFromSettings(tx,{userId,requestId:requestKey(key),change:body}))};}
 @Post('life-events/:id/state') @HttpCode(200) async state(@Req() req:Request,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body(new ZodValidationPipe(z.object({state:z.enum(['planned','ongoing','completed','cancelled']),expectedVersion:version}).strict())) body:{state:LifeChange['state'];expectedVersion:number}){
  const {userId}=requirePrincipal(req);if(!z.string().uuid().safeParse(id).success)throw new BadRequestException('无效的近期事件编号');
  return {data:await this.transactions.runAsUser(userId,tx=>writeLifeFromSettings(tx,{userId,requestId:requestKey(key),targetId:id,expectedVersion:body.expectedVersion,change:{subject:'',state:body.state,scheduledDay:null}}))};
 }
}
@Module({controllers:[CompanionController]})
export class CompanionModule {}
