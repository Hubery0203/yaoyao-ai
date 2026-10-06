import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  listMemories,
  type TransactionManager,
} from "@yaoyao/application";
import type { MemoryStatus, MemoryType } from "@yaoyao/domain";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { projectMemory } from "../common/projections.js";
import { MemoriesQuerySchema } from "./dto.js";

/** GET /memories — JWT, owner-scoped, paginated memory presentation data. */
@ApiTags("memories")
@Controller("memories")
export class MemoriesController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

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
