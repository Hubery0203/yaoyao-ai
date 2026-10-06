import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AUTH_CREDENTIALS,
  AuthorizationError,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  TRANSACTION_MANAGER,
  getUserProfile,
  registerUser,
  type AuthCredentialRepository,
  type AuthDeps,
  type PasswordHasher,
  type TokenService,
  type TransactionManager,
} from "@yaoyao/application";
import type { Request } from "express";
import { Public } from "../auth/public.decorator.js";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { projectUser } from "../common/projections.js";
import { RegisterSchema, UserIdParamSchema } from "./dto.js";

/**
 * User endpoints (proposal §C.2).
 *
 * POST /users — public, rate-limited. Creates the user AND the full Core
 *   foundation transactionally (T001/T009). The idempotency scope is
 *   server-defined (public:registration); the client cannot supply one.
 * GET /users/{user_id} — JWT, self-only. Cross-user reads are 403.
 */
@ApiTags("users")
@Controller("users")
export class UsersController {
  private readonly deps: AuthDeps;

  constructor(
    @Inject(AUTH_CREDENTIALS) credentials: AuthCredentialRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_SERVICE) tokens: TokenService,
  ) {
    this.deps = { credentials, transactions: this.transactions, hasher: this.hasher, tokens };
  }

  @Public()
  @Throttle({ register: { limit: 10, ttl: 3_600_000 } })
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Register a user and initialize its YaoYao Core" })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: {
      email: string;
      password: string;
    },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    // The HTTP layer hashes before calling the use case: raw passwords
    // never cross into application/domain (proposal §D.1).
    const passwordHash = await this.hasher.hash(body.password);
    const result = await registerUser(this.deps, {
      email: body.email,
      passwordHash,
      idempotencyKey,
      // Canonical body for the idempotency request-hash: the validated DTO.
      requestBody: JSON.stringify({ email: body.email.trim() }),
    });
    return {
      data: {
        userId: result.userId as string,
        yaoyaoId: result.yaoyaoId,
        sessionId: result.sessionId,
        duplicate: result.duplicate,
      },
    };
  }

  @Get(":user_id")
  @ApiOperation({ summary: "Get user-level information (self only)" })
  async getProfile(
    @Req() request: Request,
    @Param(new ZodValidationPipe(UserIdParamSchema)) params: {
      user_id: string;
    },
  ) {
    const { userId } = requirePrincipal(request);
    if (params.user_id !== (userId as string)) {
      // Never reveal whether the other user exists.
      throw new AuthorizationError("cross-user read forbidden");
    }
    const user = await this.transactions.runAsUser(userId, (tx) =>
      getUserProfile(tx, { userId }),
    );
    return { data: projectUser(user) };
  }
}
