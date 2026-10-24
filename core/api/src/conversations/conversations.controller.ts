import { Body, Controller, HttpCode, Inject, Post, Req, Get, Query, Headers, BadRequestException, Optional, HttpException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { TRANSACTION_MANAGER, type TransactionManager } from "@yaoyao/application";
import { randomUUID } from "node:crypto";
import {
  CONVERSATION_ORCHESTRATOR,
  ConversationOrchestrator,
  summarizeTurnQuality,
  summarizeTurnPerformance,
} from "@yaoyao/runtime";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SendMessageSchema } from "./dto.js";

/** Owner-scoped conversation history, connection metadata and retry-safe turns. */
@ApiTags("conversations")
@Controller("conversations")
export class ConversationsController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions:TransactionManager,
    @Inject("YAOYAO_CONNECTION_INFO") private readonly connectionInfo:{provider:string;model:string},
    @Inject(CONVERSATION_ORCHESTRATOR)
    private readonly orchestrator: ConversationOrchestrator,
    @Optional() @Inject("CONVERSATION_GATE") private readonly gate?:{acquire():boolean;release():void},
    @Optional() @Inject("CONVERSATION_QUALITY") private readonly quality?:{record(entry:ReturnType<typeof summarizeTurnQuality>):void},
    @Optional() @Inject("CONVERSATION_PERFORMANCE") private readonly performance?:{record(entry:ReturnType<typeof summarizeTurnPerformance>,source:"web"|"weixin"):void},
  ) {}

  @Get("connection")
  connection(@Req() request:Request) { requirePrincipal(request); return {data:this.connectionInfo}; }

  @Get("messages")
  async history(@Req() request:Request,
    @Query(new ZodValidationPipe(z.object({limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().min(0).default(0)}))) query:{limit:number;offset:number}) {
    const {userId}=requirePrincipal(request);
    return this.transactions.runAsUser(userId,async tx=>{
      const aggregate=await tx.aggregates.loadOwned(userId);
      const page=tx.events.readWindow?await tx.events.readWindow(userId,aggregate.yaoyaoId,{types:["USER_MESSAGE","ASSISTANT_MESSAGE"],limit:query.limit,offset:query.offset,count:true}):null;
      const events=page?.events??await tx.events.readOwnedAfter(userId,aggregate.yaoyaoId,0);
      const messages=events.filter(({event})=>["USER_MESSAGE","ASSISTANT_MESSAGE"].includes(event.type))
        .map(({event,aggregateSeq})=>({id:String(event.eventId),role:event.type==="USER_MESSAGE"?"user":"assistant",
          requestId:event.correlationId,text:typeof event.payload.text==="string"?event.payload.text:"",occurredAt:event.occurredAt.toISOString(),sequence:aggregateSeq}));
      const end=Math.max(0,messages.length-query.offset);
      return {data:{messages:page?messages:messages.slice(Math.max(0,end-query.limit),end),total:page?.total??messages.length,offset:query.offset,limit:query.limit}};
    });
  }

  @Post("messages")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a retry-safe message to YaoYao" })
  async sendMessage(
    @Req() request: Request,
    @Headers("idempotency-key") requestId:string|undefined,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: { text: string },
  ): Promise<{ response: string }> {
    const { userId } = requirePrincipal(request);
    if(requestId!==undefined && (typeof requestId!=="string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))) throw new BadRequestException("Invalid Idempotency-Key");
    if(this.gate&&!this.gate.acquire())throw new HttpException({error:{code:"SERVER_BUSY",message:"服务繁忙，请稍后重试。"}},429);
    try {
    const { response,trace } = await this.orchestrator.converse({
      userId,
      text: body.text,
      traceId: randomUUID(),
      requestId,
    });
    try{this.quality?.record(summarizeTurnQuality(trace));}catch{/* Telemetry cannot turn a committed message into a failed send. */}
    try{this.performance?.record(summarizeTurnPerformance(trace),"web");}catch{/* Telemetry cannot fail a committed reply. */}
    return { response };
    }finally{this.gate?.release();}
  }
}
