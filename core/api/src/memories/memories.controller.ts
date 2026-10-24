import { Body, Controller, Get, Inject, Query, Req, Param, Post, ParseUUIDPipe, ParseIntPipe, NotFoundException, Headers, BadRequestException, HttpCode } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  listMemories,
  resolveMemoryCandidate,
  replayMemoryEvaluation,
  readMemoryDetail,
  correctOwnedMemory,
  type TransactionManager,
  type CandidateAudit,
} from "@yaoyao/application";
import type { MemoryId, MemoryStatus, MemoryType } from "@yaoyao/domain";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { projectMemory } from "../common/projections.js";
import { z } from "zod";
import { MemoriesQuerySchema } from "./dto.js";

/** GET /memories — JWT, owner-scoped, paginated memory presentation data. */
@ApiTags("memories")
@Controller("memories")
export class MemoriesController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  @Get("candidates")
  async candidates(@Req() request:Request) {
    const {userId}=requirePrincipal(request);
    return {data:await this.transactions.runAsUser(userId,tx=>tx.continuityProcessing.listAudits(userId,100))};
  }
  @Get("candidates/:jobId/:ordinal/evaluation")
  async evaluate(@Req() request:Request,@Param("jobId",ParseUUIDPipe) jobId:string,@Param("ordinal",ParseIntPipe) ordinal:number) {
    const {userId}=requirePrincipal(request);
    return {data:await this.transactions.runAsUser(userId,tx=>replayMemoryEvaluation(tx,userId,jobId,ordinal))};
  }
  @Post("candidates/:jobId/:ordinal/resolve")
  async resolve(@Req() request:Request,@Param("jobId",ParseUUIDPipe) jobId:string,
    @Param("ordinal",ParseIntPipe) ordinal:number,
    @Body(new ZodValidationPipe(z.object({decision:z.enum(["confirm","discard"])}).strict())) body:{decision:"confirm"|"discard"}) {
    const {userId}=requirePrincipal(request);
    return {data:await this.transactions.runAsUser(userId,tx=>resolveMemoryCandidate(tx,userId,jobId,ordinal,body.decision))};
  }
  @Get("continuity-jobs")
  async jobs(@Req() request:Request) {
    const {userId}=requirePrincipal(request);
    return {data:await this.transactions.runAsUser(userId,tx=>tx.continuityProcessing.listJobs(userId,100))};
  }
  @Post("continuity-jobs/:jobId/requeue")
  async requeue(@Req() request:Request,@Param("jobId",ParseUUIDPipe) jobId:string) {
    const {userId}=requirePrincipal(request);
    const requeued=await this.transactions.runAsUser(userId,tx=>tx.continuityProcessing.requeue(userId,jobId));
    if(!requeued) throw new NotFoundException("Failed job not found");
    return {data:{requeued}};
  }

  @Get("review")
  async review(@Req() request:Request,
    @Query(new ZodValidationPipe(z.object({status:z.enum(["pending","resolved"]).default("pending"),
      limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}))) query:{status:"pending"|"resolved";limit:number;offset:number}) {
    const {userId}=requirePrincipal(request);
    return this.transactions.runAsUser(userId,async tx=>{
      if(!tx.continuityProcessing.reviewPage)throw new NotFoundException("Review pagination unavailable");
      const page=await tx.continuityProcessing.reviewPage(userId,query);
      return {data:{...page,rows:page.rows.map(row=>{
        const a=row.audit as CandidateAudit;const resolution=row.resolution as {decision?:unknown;memoryId?:unknown}|null;
        return {job_id:String(row.job_id),ordinal:Number(row.ordinal),created_at:row.created_at,
          audit:{outcome:a.outcome,reason:a.reason,candidate:{content:a.candidate.content,evidence:a.candidate.evidence,kind:a.candidate.kind}},
          resolution:resolution?{decision:resolution.decision,memoryId:resolution.memoryId}:null};
      })}};
    });
  }
  @Get(":memoryId/detail")
  async detail(@Req() request:Request,@Param("memoryId",ParseUUIDPipe) memoryId:string) {
    const {userId}=requirePrincipal(request);
    return this.transactions.runAsUser(userId,async tx=>{
      const d=await readMemoryDetail(tx,userId,memoryId as MemoryId);
      return {data:{...d,memory:projectMemory(d.memory),history:d.history.map(projectMemory)}};
    });
  }
  @Post(":memoryId/correct")
  @HttpCode(200)
  async correct(@Req() request:Request,@Param("memoryId",ParseUUIDPipe) memoryId:string,
    @Headers("idempotency-key") key:string|undefined,
    @Body(new ZodValidationPipe(z.object({text:z.string().trim().min(1).max(500),expectedVersion:z.number().int().min(1)}).strict())) body:{text:string;expectedVersion:number}) {
    const {userId}=requirePrincipal(request);
    if(typeof key!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(key))throw new BadRequestException("Idempotency-Key required");
    return {data:await this.transactions.runAsUser(userId,tx=>correctOwnedMemory(tx,{userId,memoryId:memoryId as MemoryId,
      text:body.text,expectedVersion:body.expectedVersion,requestId:key}))};
  }
  @Get()
  @ApiOperation({ summary: "Read authorized memory presentation data" })
  async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(MemoriesQuerySchema)) query: {
      type?: MemoryType;
      status?: MemoryStatus;
      limit?: number;
      offset?: number;
    },
  ) {
    const { userId } = requirePrincipal(request);
    const page = await this.transactions.runAsUser(userId, (tx) =>
      listMemories(tx, {
        userId,
        type: query.type,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      }),
    );
    return {
      data: {
        memories: page.memories.map(projectMemory),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      },
    };
  }
}
