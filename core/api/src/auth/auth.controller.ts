import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AUTH_CREDENTIALS,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  TRANSACTION_MANAGER,
  authenticateUser,
  refreshTokens,
  revokeRefreshSession,
  type AuthCredentialRepository,
  type AuthDeps,
  type PasswordHasher,
  type TokenService,
  type TransactionManager,
} from "@yaoyao/application";
import type { Request } from "express";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { requirePrincipal } from "./jwt-auth.guard.js";
import { LoginSchema, RefreshSchema } from "./dto.js";
import { Public } from "./public.decorator.js";

/**
 * Authentication endpoints (proposal §C.1).
 *
 * POST /auth/login   — public, rate-limited; email+password -> token pair.
 * POST /auth/refresh — public, rate-limited; single-use refresh rotation.
 * POST /auth/logout  — JWT; revokes the refresh-token family.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly deps: AuthDeps;

  constructor(
    @Inject(AUTH_CREDENTIALS) credentials: AuthCredentialRepository,
    @Inject(TRANSACTION_MANAGER) transactions: TransactionManager,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(TOKEN_SERVICE) tokens: TokenService,
  ) {
    this.deps = { credentials, transactions, hasher, tokens };
  }

  @Public()
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Authenticate with email + password" })
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: {
    email: string;
    password: string;
    deviceMetadata?: Record<string, unknown>;
  }) {
    const result = await authenticateUser(this.deps, {
      email: body.email,
      password: body.password,
      deviceMetadata: body.deviceMetadata,
    });
    return {
      data: {
        userId: result.userId as string,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        tokenType: "Bearer",
      },
    };
  }

  @Public()
  @Throttle({ refresh: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate a refresh token (single-use)" })
  async refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: {
    refreshToken: string;
  }) {
    const result = await refreshTokens(this.deps, {
      refreshToken: body.refreshToken,
    });
    return {
      data: {
        userId: result.userId as string,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        tokenType: "Bearer",
      },
    };
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke the refresh-token family" })
  async logout(
    @Req() request: Request,
    @Body(new ZodValidationPipe(RefreshSchema)) body: {
      refreshToken: string;
    },
  ) {
    requirePrincipal(request);
    const result = await revokeRefreshSession(this.deps, {
      refreshToken: body.refreshToken,
    });
    return { data: { revoked: result.revoked } };
  }
}
