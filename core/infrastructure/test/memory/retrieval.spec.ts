/**
 * MVP-002D adapter tests — no-mutation guarantees (D10, D11).
 *
 * D10 No Creation: retrieval changes nothing (static + behavioral).
 * D11 No Mutation: the adapter source contains no write statements,
 *         and the port has no write methods.
 * D14 No Hallucination (unit level): EmptyMemoryRetrieval returns empty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EmptyMemoryRetrieval } from "@yaoyao/application";

const here = dirname(fileURLToPath(import.meta.url));
const retrievalSrc = readFileSync(
  join(here, "..", "..", "src", "memory", "retrieval.ts"),
  "utf8",
);

describe("D10/D11 — Retrieval never mutates", () => {
  it("the adapter source contains no write statements", () => {
    expect(retrievalSrc).not.toMatch(/\.insert\(/);
    expect(retrievalSrc).not.toMatch(/\.update\(/);
    expect(retrievalSrc).not.toMatch(/\.delete\(/);
    // No domain mutators are CALLED (mentions in comments don't count).
    const codeOnly = retrievalSrc
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//");
      })
      .join("\n");
    expect(codeOnly).not.toMatch(/recordRecall\(/);
    expect(codeOnly).not.toMatch(/\.validate\(\)/);
    expect(codeOnly).not.toMatch(/\.consolidate\(\)/);
    expect(codeOnly).not.toMatch(/\.correct\(/);
    expect(codeOnly).not.toMatch(/\.archive\(/);
  });

  it("the MemoryRetrieval port exposes no write methods", async () => {
    const portSrc = readFileSync(
      join(
        here,
        "..",
        "..",
        "..",
        "application",
        "src",
        "ports",
        "memory-retrieval.ts",
      ),
      "utf8",
    );
    // The interface has exactly one method: retrieve.
    const interfaceBody = portSrc.match(
      /export interface MemoryRetrieval \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(interfaceBody).toBeDefined();
    expect(interfaceBody).toContain("retrieve");
    expect(interfaceBody).not.toMatch(/\b(save|insert|update|delete|create)\b/i);
  });
});

describe("D14 — No hallucination (unit level)", () => {
  it("EmptyMemoryRetrieval returns zero memories, never synthesized", async () => {
    const empty = new EmptyMemoryRetrieval();
    const result = await empty.retrieve({
      userId: "u" as never,
      yaoyaoId: "y" as never,
      currentInput: "用户喜欢什么咖啡？",
      situation: { intent: "chat", urgency: "normal", taskNature: "general" },
      relationshipContext: { type: "deep_partner", status: "active" },
      recentConversation: [],
      limit: 50,
      traceId: "t",
    });
    expect(result.memories).toEqual([]);
    expect(result.telemetry.candidateCount).toBe(0);
    expect(result.telemetry.selectedCount).toBe(0);
  });
});
