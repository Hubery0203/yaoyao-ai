import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  listEvents,
  type TransactionManager,
} from "@yaoyao/application";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { projectEvent } from "../common/projections.js";
import { EventsQuerySchema } from "./dto.js";

/** GET /events — JWT, owner-scoped, paginated authorized event history. */
@ApiTags("events")
@Controller("events")
export class EventsController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  @Get()
  @ApiOperation({ summary: "Read authorized event history" })
  async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(EventsQuerySchema)) query: {
      limit?: number;
      offset?: number;
    },
  ) {
    const { userId } = requirePrincipal(request);
    const page = await this.transactions.runAsUser(userId, (tx) =>
      listEvents(tx, { userId, limit: query.limit, offset: query.offset }),
    );
    return {
      data: {
        events: page.events.map(projectEvent),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      },
    };
  }
}
