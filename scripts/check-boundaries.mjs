#!/usr/bin/env node
/**
 * CI boundary gate — runs dependency-cruiser over the workspace and fails
 * the build on any architecture violation.
 *
 * Usage: node scripts/check-boundaries.mjs [--json]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runCruiser(targets) {
  const out = execFileSync(
    process.execPath,
    [
      "./node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
      "--config",
      ".dependency-cruiser.cjs",
      "--output-type",
      "json",
      ...targets,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out);
}

const asJson = process.argv.includes("--json");
const result = runCruiser(["core", "apps"]);
const violations = result.summary?.violations ?? [];

if (asJson) {
  console.log(JSON.stringify({ violations }, null, 2));
} else if (violations.length === 0) {
  console.log(`✓ architecture boundaries hold: 0 violations across ${result.summary?.totalCruised ?? "?"} modules`);
} else {
  console.error(`✗ ${violations.length} architecture violation(s):`);
  for (const v of violations) {
    console.error(`  [${v.rule?.severity ?? "error"}] ${v.rule?.name}: ${v.from} → ${v.to}`);
  }
}

process.exit(violations.length === 0 ? 0 : 1);
