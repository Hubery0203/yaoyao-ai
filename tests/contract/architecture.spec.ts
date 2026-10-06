import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_NAME = "__boundary-fixture__.tmp.ts";

interface Violation {
  rule: { name: string; severity: string };
  from: string;
  to: string;
}

/** Run dependency-cruiser over the given targets and return violations. */
function cruise(targets: string[]): Violation[] {
  const out = execFileSync(
    path.join(
      ROOT,
      "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
    ),
    ["--config", ".dependency-cruiser.cjs", "--output-type", "json", ...targets],
    { cwd: ROOT, encoding: "utf8" },
  );
  const parsed = JSON.parse(out) as { summary: { violations: Violation[] } };
  return parsed.summary.violations;
}

describe("architecture boundaries (dependency-cruiser)", () => {
  it("real sources have zero violations", () => {
    const violations = cruise(["core", "apps"]);
    expect(violations).toEqual([]);
  });

  it("a forbidden domain → framework import is rejected", () => {
    // The fixture simulates a domain file importing @nestjs/common.
    // It must FAIL the boundary check (this is the Phase 1 exit criterion).
    const fixturePath = path.join(ROOT, "core/domain/src", FIXTURE_NAME);
    writeFileSync(
      fixturePath,
      [
        "// BOUNDARY FIXTURE — must be flagged by dependency-cruiser.",
        'import { Injectable } from "@nestjs/common";',
        "export const marker = Injectable;",
        "",
      ].join("\n"),
    );
    try {
      const violations = cruise(["core/domain"]);
      const names = violations.map((v) => v.rule.name);
      expect(names).toContain("domain-is-framework-free");
      expect(violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(fixturePath, { force: true });
    }
  });
});
