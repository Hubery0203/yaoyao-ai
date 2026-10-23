import { Body, Controller, HttpCode, Inject, Post, Req, Get, Query, Headers, BadRequestException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { TRANSACTION_MANAGER, type TransactionManager } from "@yaoyao/application";
import { randomUUID } from "node:crypto";
import {
  CONVERSATION_ORCHESTRATOR,
  ConversationOrchestrator,
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
  ) {}

  @Get("connection")
  connection(@Req() request:Request) { requirePrincipal(request); return {data:this.connectionInfo}; }

  @Get("messages")
  async history(@Req() request:Request,
    @Query(new ZodValidationPipe(z.object({limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().min(0).default(0)}))) query:{limit:number;offset:number}) {
    const {userId}=requirePrincipal(request);
    return this.transactions.runAsUser(userId,async tx=>{
      const aggregate=await tx.aggregates.loadOwned(userId);
      const events=await tx.events.readOwnedAfter(userId,aggregate.yaoyaoId,0);
      const messages=events.filter(({event})=>["USER_MESSAGE","ASSISTANT_MESSAGE"].includes(event.type))
        .map(({event,aggregateSeq})=>({id:String(event.eventId),role:event.type==="USER_MESSAGE"?"user":"assistant",
          requestId:event.correlationId,text:typeof event.payload.text==="string"?event.payload.text:"",occurredAt:event.occurredAt.toISOString(),sequence:aggregateSeq}));
      const end=Math.max(0,messages.length-query.offset);
      return {data:{messages:messages.slice(Math.max(0,end-query.limit),end),total:messages.length,offset:query.offset,limit:query.limit}};
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
    const { response } = await this.orchestrator.converse({
      userId,
      text: body.text,
      traceId: randomUUID(),
      requestId,
    });
    return { response };
  }
}
