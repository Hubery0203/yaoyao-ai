import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  replayDiagnostics,
  type ReplayReadPort,
  type TransactionManager,
} from "@yaoyao/application";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ReplayQuerySchema } from "./dto.js";

/**
 * GET /diagnostics/replay — JWT, owner-scoped, READ-ONLY.
 *
 * Replays the ordered event sequence through the production domain
 * transition functions and diffs the reconstruction against the persisted
 * state (T011). The use case receives a read-only port bundle: it cannot
 * open a write transaction, append events, or enqueue outbox intents —
 * the types forbid it (T012). The response is diagnostic JSON, never
 * applied to production state.
 */
@ApiTags("diagnostics")
@Controller("diagnostics")
export class DiagnosticsController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  @Get("replay")
  @ApiOperation({ summary: "Read-only event replay diagnostic" })
  async replay(
    @Req() request: Request,
    @Query(new ZodValidationPipe(ReplayQuerySchema)) query: {
      from_seq?: number;
    },
  ) {
    const { userId } = requirePrincipal(request);
    // runAsUser pins the RLS owner context for the reads; the port bundle
    // handed to the use case exposes reads only.
    const result = await this.transactions.runAsUser(userId, (tx) => {
      const read: ReplayReadPort = {
        aggregates: tx.aggregates,
        states: tx.states,
        events: tx.events,
      };
      return replayDiagnostics(read, { userId, fromSeq: query.from_seq });
    });
    return {
      data: {
        yaoyaoId: result.yaoyaoId as string,
        eventsFolded: result.eventsFolded,
        reconstructedVersion: result.reconstructedVersion,
        persistedVersion: result.persistedVersion,
        match: result.match,
        diffs: result.diffs,
        trace: result.trace,
      },
    };
  }
}
