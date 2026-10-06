import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AuthenticationError,
  TOKEN_SERVICE,
  type TokenService,
} from "@yaoyao/application";
import type { UserId } from "@yaoyao/domain";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface RequestPrincipal {
  userId: UserId;
}

declare module "express-serve-static-core" {
  interface Request {
    principal?: RequestPrincipal;
  }
}

/**
 * Global authentication guard (proposal §E.1).
 *
 * Default-deny: every route requires a Bearer access JWT unless marked
 * @Public(). Verification is stateless (signature + expiry + issuer +
 * audience + claim shape) via the TokenService port — the guard never
 * touches the database. Ownership is NOT established here; each use case
 * re-verifies ownership through *Owned repository methods (PM rule 2).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new AuthenticationError("missing bearer token");
    }
    const claims = this.tokens.verifyAccessToken(token);
    request.principal = { userId: claims.sub as UserId };
    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers["authorization"];
  if (!header || Array.isArray(header)) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Read the principal or throw — for use inside protected controllers. */
export function requirePrincipal(request: Request): RequestPrincipal {
  const principal = request.principal;
  if (!principal) {
    throw new AuthenticationError("not authenticated");
  }
  return principal;
}
