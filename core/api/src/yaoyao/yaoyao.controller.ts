import { Controller, Get, Inject, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  TRANSACTION_MANAGER,
  getCurrentState,
  getRelationship,
  getYaoYaoIdentity,
  type TransactionManager,
} from "@yaoyao/application";
import type { Request } from "express";
import { requirePrincipal } from "../auth/jwt-auth.guard.js";
import {
  projectRelationship,
  projectState,
  projectYaoYaoIdentity,
} from "../common/projections.js";

/**
 * YaoYao identity / state / relationship reads (proposal §C.2).
 *
 * All three are JWT-protected, owner-scoped, and return client-safe
 * projections — never raw rows. There are deliberately no write routes
 * here: the Core decides persistent state (Handoff §13).
 */
@ApiTags("yaoyao")
@Controller("yaoyao")
export class YaoYaoController {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  @Get()
  @ApiOperation({ summary: "Authoritative YaoYao identity presentation" })
  async getIdentity(@Req() request: Request) {
    const { userId } = requirePrincipal(request);
    const aggregate = await this.transactions.runAsUser(userId, (tx) =>
      getYaoYaoIdentity(tx, { userId }),
    );
    return { data: projectYaoYaoIdentity(aggregate.yaoyao) };
  }

  @Get("state")
  @ApiOperation({ summary: "Client-safe current state" })
  async getState(@Req() request: Request) {
    const { userId } = requirePrincipal(request);
    const state = await this.transactions.runAsUser(userId, (tx) =>
      getCurrentState(tx, { userId }),
    );
    return { data: projectState(state) };
  }

  @Get("relationship")
  @ApiOperation({ summary: "Client-safe relationship state" })
  async getRelationship(@Req() request: Request) {
    const { userId } = requirePrincipal(request);
    const relationship = await this.transactions.runAsUser(userId, (tx) =>
      getRelationship(tx, { userId }),
    );
    return { data: projectRelationship(relationship) };
  }
}
