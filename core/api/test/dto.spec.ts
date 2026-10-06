/**
 * DTO validation tests (Phase 4, proposal §C.5).
 *
 * Controllers accept zod-validated DTOs, never domain entities. These
 * tests pin the accept/reject boundary for every input schema.
 */
import { describe, expect, it } from "vitest";
import { LoginSchema, RefreshSchema } from "../src/auth/dto.js";
import { ReplayQuerySchema } from "../src/diagnostics/dto.js";
import { EventsQuerySchema } from "../src/events/dto.js";
import { MemoriesQuerySchema } from "../src/memories/dto.js";
import { SessionIdParamSchema, StartSessionSchema } from "../src/sessions/dto.js";
import { RegisterSchema, UserIdParamSchema } from "../src/users/dto.js";

describe("LoginSchema", () => {
  it("accepts a well-formed login", () => {
    expect(
      LoginSchema.safeParse({ email: "a@b.c", password: "secret123" }).success,
    ).toBe(true);
  });
  it("rejects empty email/password", () => {
    expect(LoginSchema.safeParse({ email: "", password: "x" }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: "a@b.c", password: "" }).success).toBe(false);
  });
  it("rejects unknown fields being silently dropped (strictness is opt-in)", () => {
    // Extra fields are stripped by zod's default behavior; the test pins it.
    const parsed = LoginSchema.safeParse({
      email: "a@b.c",
      password: "x",
      isAdmin: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>)["isAdmin"]).toBeUndefined();
    }
  });
});

describe("RegisterSchema", () => {
  it("accepts a valid registration", () => {
    expect(
      RegisterSchema.safeParse({ email: "n@u.io", password: "long-enough" }).success,
    ).toBe(true);
  });
  it("rejects short passwords", () => {
    expect(
      RegisterSchema.safeParse({ email: "n@u.io", password: "short" }).success,
    ).toBe(false);
  });
});

describe("RefreshSchema", () => {
  it("accepts a token and rejects an empty one", () => {
    expect(RefreshSchema.safeParse({ refreshToken: "abc" }).success).toBe(true);
    expect(RefreshSchema.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(RefreshSchema.safeParse({}).success).toBe(false);
  });
});

describe("StartSessionSchema / SessionIdParamSchema", () => {
  it("accepts empty body and optional clientInstanceId", () => {
    expect(StartSessionSchema.safeParse({}).success).toBe(true);
    expect(
      StartSessionSchema.safeParse({ clientInstanceId: "device-1" }).success,
    ).toBe(true);
  });
  it("accepts a session id param", () => {
    expect(SessionIdParamSchema.safeParse({ session_id: "s-1" }).success).toBe(true);
    expect(SessionIdParamSchema.safeParse({ session_id: "" }).success).toBe(false);
  });
});

describe("EventsQuerySchema", () => {
  it("coerces pagination params and enforces the limit cap", () => {
    const parsed = EventsQuerySchema.safeParse({ limit: "50", offset: "10" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(50);
      expect(parsed.data.offset).toBe(10);
    }
    expect(EventsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe("MemoriesQuerySchema", () => {
  it("accepts valid type/status filters and rejects unknown ones", () => {
    expect(
      MemoriesQuerySchema.safeParse({ type: "EPISODIC", status: "CANDIDATE" }).success,
    ).toBe(true);
    expect(MemoriesQuerySchema.safeParse({ type: "NOPE" }).success).toBe(false);
    expect(MemoriesQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});

describe("ReplayQuerySchema", () => {
  it("accepts empty and from_seq queries", () => {
    expect(ReplayQuerySchema.safeParse({}).success).toBe(true);
    expect(ReplayQuerySchema.safeParse({ from_seq: "3" }).success).toBe(true);
    expect(ReplayQuerySchema.safeParse({ from_seq: "-1" }).success).toBe(false);
  });
});

describe("UserIdParamSchema", () => {
  it("accepts a user id param", () => {
    expect(UserIdParamSchema.safeParse({ user_id: "u-1" }).success).toBe(true);
  });
});
