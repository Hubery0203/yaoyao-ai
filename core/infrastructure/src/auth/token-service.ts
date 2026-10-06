/**
 * JWT access tokens + rotating refresh tokens (Phase 4, proposal §D.2).
 *
 * - Access JWT: HS256, 15-minute default TTL, claims { sub, iat, exp },
 *   issuer/audience pinned. Stateless; no revocation list (short TTL
 *   bounds theft).
 * - Refresh tokens: 256-bit random, base64url. Only SHA-256 hashes
 *   persist — a database read never yields a usable token.
 *
 * Fail-closed construction (proposal risk R1): a missing secret or a
 * secret shorter than 256 bits throws at startup — the host never runs
 * misconfigured.
 */
import {
  AuthenticationError,
  type AccessTokenClaims,
  type TokenService,
} from "@yaoyao/application";
import { isUuidV7, type UserId } from "@yaoyao/domain";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { AppConfig } from "../config/env.js";

export interface JwtTokenServiceOptions {
  secret: string | undefined;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

export function tokenServiceOptionsFromConfig(
  config: AppConfig,
): JwtTokenServiceOptions {
  return {
    secret: config.JWT_ACCESS_SECRET,
    ttlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };
}

export class JwtTokenService implements TokenService {
  readonly accessTokenTtlSeconds: number;
  private readonly secret: Buffer;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(options: JwtTokenServiceOptions) {
    const secret = options.secret ?? "";
    // 256-bit minimum: HS256 with a shorter key is a forgery risk.
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error(
        "JWT_ACCESS_SECRET must be set and at least 256 bits (32 bytes); refusing to start",
      );
    }
    this.secret = Buffer.from(secret, "utf8");
    this.accessTokenTtlSeconds = options.ttlSeconds;
    this.issuer = options.issuer;
    this.audience = options.audience;
  }

  mintAccessToken(userId: UserId): string {
    return jwt.sign({}, this.secret, {
      algorithm: "HS256",
      subject: userId as string,
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: this.accessTokenTtlSeconds,
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: this.issuer,
        audience: this.audience,
      });
    } catch {
      throw new AuthenticationError("invalid or expired access token");
    }
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as { sub?: unknown }).sub !== "string" ||
      !isUuidV7((decoded as { sub: string }).sub)
    ) {
      throw new AuthenticationError("invalid access token claims");
    }
    const claims = decoded as { sub: string; iat: number; exp: number };
    return { sub: claims.sub, iat: claims.iat, exp: claims.exp };
  }

  newRefreshToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashRefreshToken(raw: string): Buffer {
    return createHash("sha256").update(raw, "utf8").digest();
  }
}
