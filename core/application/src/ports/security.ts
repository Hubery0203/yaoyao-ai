/**
 * Security ports — authentication and credential contracts for Phase 4.
 *
 * Declared in @yaoyao/application so use cases (and the HTTP layer's guard)
 * depend on stable interfaces. Implementations live in
 * @yaoyao/infrastructure/auth and are wired in apps/*.
 *
 * Design rules:
 * - PasswordHasher / TokenService are injected; use cases never import
 *   argon2, jsonwebtoken, or any provider SDK.
 * - AuthCredentialRepository is the ONLY port allowed to resolve credentials
 *   without an owner context; it is backed by narrowly-scoped SECURITY
 *   DEFINER functions (migration 0002), never by a broad RLS bypass.
 * - Raw passwords and raw refresh tokens never cross into the domain.
 */
import type { UserId, UserStatus } from "@yaoyao/domain";
import type { RefreshSessionRecord } from "./persistence/repositories.js";
import type { TransactionManager } from "./persistence/transactions.js";

/** Credential verification failed (unknown user or wrong password). */
export class AuthenticationError extends Error {
  readonly code = "AUTHENTICATION_FAILED";

  constructor(message = "invalid credentials") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** An authenticated principal attempted an action outside its ownership. */
export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";

  constructor(message = "forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Argon2id password hashing (OWASP interactive baseline). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/** Decoded access-token claims. `sub` is the authenticated userId. */
export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Short-lived JWT access tokens + long-lived rotating refresh tokens.
 * Only SHA-256 hashes of refresh tokens are ever persisted.
 */
export interface TokenService {
  /** Access-token lifetime in seconds (mirrors JWT_ACCESS_TTL_SECONDS). */
  readonly accessTokenTtlSeconds: number;
  /** Mint a short-lived access JWT for the user. */
  mintAccessToken(userId: UserId): string;
  /**
   * Verify signature, expiry, issuer/audience and claim shape.
   * Throws AuthenticationError on any failure.
   */
  verifyAccessToken(token: string): AccessTokenClaims;
  /** 256-bit random refresh token, base64url-encoded. */
  newRefreshToken(): string;
  /** SHA-256 digest of a raw refresh token (bytea storage). */
  hashRefreshToken(raw: string): Buffer;
}

/** Credential row for login — the minimum the auth flow needs. */
export interface AuthCredentialRecord {
  userId: UserId;
  passwordHash: string;
  status: UserStatus;
}

/**
 * Unauthenticated credential resolution.
 *
 * Backed by SECURITY DEFINER functions (migration 0002). This is the only
 * port that reads without an RLS owner context; every other repository
 * method stays owner-scoped. Callers must still verify ownership for any
 * subsequent action via the *Owned repository methods inside a
 * runAsUser transaction (defense in depth — a valid lookup is not proof
 * of ownership).
 */
export interface AuthCredentialRepository {
  /** Exact-email credential lookup; null when no such user. */
  findUserCredentialsByEmail(email: string): Promise<AuthCredentialRecord | null>;
  /** Refresh-session lookup by token hash; null when unknown. */
  findRefreshSessionByTokenHash(
    tokenHash: Buffer,
  ): Promise<RefreshSessionRecord | null>;
}

/**
 * Server-defined idempotency scope for the unauthenticated registration
 * endpoint (PM rule 1). The client MUST NOT supply a userId scope —
 * registerUser hardcodes this constant; it never comes from request input.
 */
export const PUBLIC_REGISTRATION_SCOPE = "public:registration";

/** Dependency bundle for the auth use cases (explicit, no hidden DI). */
export interface AuthDeps {
  credentials: AuthCredentialRepository;
  transactions: TransactionManager;
  hasher: PasswordHasher;
  tokens: TokenService;
}

// ---------------------------------------------------------------------------
// NestJS injection tokens (apps/* provides infrastructure implementations).
// ---------------------------------------------------------------------------

export const PASSWORD_HASHER = "YAOYAO_PASSWORD_HASHER";
export const TOKEN_SERVICE = "YAOYAO_TOKEN_SERVICE";
export const AUTH_CREDENTIALS = "YAOYAO_AUTH_CREDENTIALS";
export const TRANSACTION_MANAGER = "YAOYAO_TRANSACTION_MANAGER";

/**
 * Optional operational health probe. Implemented in infrastructure,
 * injected into the health controller when the host wires it. Absence
 * means "not_configured" (the Phase 1 default).
 */
export const HEALTH_PROBE = "YAOYAO_HEALTH_PROBE";
export interface HealthProbe {
  /** "ok" when the database answers; "degraded" otherwise. */
  checkDatabase(): Promise<"ok" | "degraded">;
}
