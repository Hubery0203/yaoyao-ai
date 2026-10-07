import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import {
  CONVERSATION_ORCHESTRATOR,
  ConversationOrchestrator,
} from "@yaoyao/runtime";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SendMessageSchema } from "./dto.js";

/**
 * Conversation endpoints — MVP-002A Conversation Runtime Foundation.
 *
 * POST /conversations/messages — JWT; runs the Canonical Runtime 10-step
 * pipeline skeleton (HTTP → Runtime → Mock LLM Provider → Response).
 *
 * MVP-002A notes:
 * - The endpoint is authenticated (default-deny via global JwtAuthGuard);
 *   the JWT principal's userId is the turn's actor.
 * - The orchestrator is injected (wired in apps/api to the Mock provider).
 * - No session binding yet (arrives with 002B context assembly).
 * - No event persistence yet (USER_MESSAGE/ASSISTANT_MESSAGE arrive with
 *   Migration 0003, explicitly deferred per the MVP-002A authorization).
 */
@ApiTags("conversations")
@Controller("conversations")
export class ConversationsController {
  constructor(
    @Inject(CONVERSATION_ORCHESTRATOR)
    private readonly orchestrator: ConversationOrchestrator,
  ) {}

  @Post("messages")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a message to YaoYao (MVP-002A skeleton)" })
  async sendMessage(
    @Req() request: Request,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: { text: string },
  ): Promise<{ response: string }> {
    const { userId } = requirePrincipal(request);
    const { response } = await this.orchestrator.converse({
      userId,
      text: body.text,
      traceId: randomUUID(),
    });
    return { response };
  }
}
