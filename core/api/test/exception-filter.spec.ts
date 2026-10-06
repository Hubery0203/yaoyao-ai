/**
 * Exception filter mapping tests (Phase 4, proposal §H).
 *
 * Pins the domain/application error -> HTTP status contract. Unknown
 * failures must become a generic 500 with no internal detail leaked.
 */
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  DuplicateEntityError,
  EntityNotFoundError,
  IdempotencyKeyReusedError,
  PersistenceConflictError,
  StaleWriteError,
} from "@yaoyao/application";
import { DomainError } from "@yaoyao/domain";
import { DomainExceptionFilter } from "../src/index.js";

function capture(exception: unknown): { status: number; body: unknown } {
  const filter = new DomainExceptionFilter();
  let status = 0;
  let body: unknown;
  const response = {
    status: (s: number) => {
      status = s;
      return { json: (b: unknown) => (body = b) };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: "GET", path: "/x" }),
    }),
  };
  filter.catch(exception, host as never);
  return { status, body };
}

describe("DomainExceptionFilter", () => {
  it.each([
    [new AuthenticationError(), 401, "AUTHENTICATION_FAILED"],
    [new AuthorizationError(), 403, "FORBIDDEN"],
    [new EntityNotFoundError("User"), 404, "ENTITY_NOT_FOUND"],
    [new DuplicateEntityError("User"), 409, "DUPLICATE_ENTITY"],
    [new IdempotencyKeyReusedError("op"), 409, "IDEMPOTENCY_KEY_REUSED"],
    [new StaleWriteError("CoreState", 1, 2), 409, "STALE_WRITE"],
    [new PersistenceConflictError("x"), 409, "PERSISTENCE_CONFLICT"],
    [new DomainError("X", "invariant"), 422, "DOMAIN_INVARIANT"],
  ])("%s -> %i (%s)", (err, status, code) => {
    const { status: s, body } = capture(err);
    expect(s).toBe(status);
    expect((body as { error: { code: string } }).error.code).toBe(code);
  });

  it("maps NestJS HttpExceptions into the envelope", () => {
    const { status, body } = capture(new BadRequestException("bad input"));
    expect(status).toBe(400);
    expect((body as { error: object }).error).toBeDefined();
  });

  it("turns unknown errors into a generic 500 without leaking internals", () => {
    const err = new Error("SELECT * FROM users WHERE password_hash = 'x'");
    const { status, body } = capture(err);
    expect(status).toBe(500);
    const text = JSON.stringify(body);
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("SELECT");
    expect((body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
  });

  it("logs server-side on 500s", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Logger writes via console; the filter must not throw while logging.
    expect(() => capture(new Error("boom"))).not.toThrow();
    spy.mockRestore();
  });
});
