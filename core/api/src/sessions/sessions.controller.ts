import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  closeSession,
  startSession,
  type TransactionManager,
} from "@yaoyao/application";
import type { SessionId } from "@yaoyao/domain";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionIdParamSchema, StartSessionSchema } from "./dto.js";

/**
 * Session lifecycle endpoints (proposal §C.2).
 *
 * POST /sessions — JWT; opens an interaction context (idempotency-key
 *   supported, server-derived user scope).
 * POST /sessions/{id}/close — JWT, owner-only; findOwned returns 404 for
 *   foreign ids (no oracle leak). Closing never cascades to YaoYao,
 *   relationship, state, or memory (T004).
 */
@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Start a new session" })
  async start(
    @Req() request: Request,
    @Body(new ZodValidationPipe(StartSessionSchema)) body: {
      clientInstanceId?: string | null;
    },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const { userId } = requirePrincipal(request);
    const result = await this.transactions.runAsUser(userId, (tx) =>
      startSession(tx, {
        userId,
        clientInstanceId: body.clientInstanceId ?? null,
        idempotency: idempotencyKey
          ? {
              key: idempotencyKey,
              requestBody: JSON.stringify({
                clientInstanceId: body.clientInstanceId ?? null,
              }),
            }
          : undefined,
      }),
    );
    return {
      data: {
        sessionId: result.sessionId as string,
        yaoyaoId: result.yaoyaoId as string,
        duplicate: result.duplicate,
      },
    };
  }

  @Post(":session_id/close")
  @HttpCode(200)
  @ApiOperation({ summary: "Close a session (idempotent)" })
  async close(
    @Req() request: Request,
    @Param(new ZodValidationPipe(SessionIdParamSchema)) params: {
      session_id: string;
    },
  ) {
    const { userId } = requirePrincipal(request);
    const result = await this.transactions.runAsUser(userId, (tx) =>
      closeSession(tx, { userId, sessionId: params.session_id as SessionId }),
    );
    return {
      data: { sessionId: result.sessionId as string, closed: result.closed },
    };
  }
}
