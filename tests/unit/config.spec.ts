import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@yaoyao/infrastructure";

describe("loadConfig", () => {
  it("applies Phase 1 defaults", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.LOG_LEVEL).toBe("info");
    expect(cfg.DATABASE_URL).toBeUndefined();
    expect(cfg.REDIS_URL).toBeUndefined();
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ PORT: "not-a-port" } as never)).toThrow(
      ConfigError,
    );
  });

  it("rejects a short JWT secret when one is provided", () => {
    expect(
      () => loadConfig({ JWT_ACCESS_SECRET: "too-short" } as never),
    ).toThrow(ConfigError);
  });

  it("accepts a valid JWT secret", () => {
    const cfg = loadConfig({
      JWT_ACCESS_SECRET: "a".repeat(32),
    } as NodeJS.ProcessEnv);
    expect(cfg.JWT_ACCESS_SECRET).toHaveLength(32);
  });
});
