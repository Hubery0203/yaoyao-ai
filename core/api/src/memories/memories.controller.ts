import { Body, Controller, Get, Inject, Query, Req, Param, Post, ParseUUIDPipe, ParseIntPipe, NotFoundException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  listMemories,
  resolveMemoryCandidate,
  replayMemoryEvaluation,
  type TransactionManager,
} from "@yaoyao/application";
import type { MemoryStatus, MemoryType } from "@yaoyao/domain";
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
