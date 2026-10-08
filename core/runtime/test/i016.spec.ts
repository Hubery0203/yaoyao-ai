/**
 * I-016 structural tests — MVP-002A.
 *
 * "No Model Output Has Direct Persistent Authority."
 *
 * These tests prove the enforcement is structural, not conventional:
 * 1. Proposal<T> is branded — it cannot be assigned where a raw value or
 *    a domain entity is expected (compile-time; asserted via expectTypeOf).
 * 2. The minimal validation gate rejects non-proposal fields (runtime).
 * 3. Unwrapping is explicit and audited (only Response Delivery unwraps).
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  asProposal,
  unwrapProposal,
  type Decision,
  type LLMProposal,
  type Proposal,
} from "@yaoyao/application";
import { validateResponse } from "@yaoyao/runtime";

describe("I-016: Proposal<T> branding", () => {
  it("a Proposal<string> is not assignable to string", () => {
    const p = asProposal("hello");
    expectTypeOf(p).not.toEqualTypeOf<string>();
    // @ts-expect-error — branded Proposal is not a raw string
    const raw: string = p;
    expect(raw).toBeDefined(); // unreachable at runtime; type test only
  });

  it("a Proposal<T> is not assignable to a domain-entity-shaped object", () => {
    interface FakeEntity {
      readonly id: string;
      readonly value: string;
    }
    const p = asProposal({ id: "1", value: "x" });
    // @ts-expect-error — Proposal branding blocks entity assignment
    const entity: FakeEntity = p;
    expect(entity).toBeDefined(); // type test only
  });

  it("unwrapProposal is the explicit, audited unwrap site", () => {
    const p = asProposal("response text");
    expect(unwrapProposal(p)).toBe("response text");
  });
});

describe("I-016: response validation gate (002F full pipeline)", () => {
  function validProposal(): LLMProposal {
    return {
      response: asProposal("嗨，宝贝，我在呢。"),
      emotion_signal: asProposal({}),
      memory_candidates: asProposal([]),
      relationship_signal: asProposal({}),
      behavior: asProposal({}),
    };
  }

  function testDecision(): Decision {
    return {
      primaryIntent: "answer",
      secondaryIntents: [],
      conversationMode: "normal",
      emotionalExpression: "low",
      initiative: "moderate",
      followUp: "optional",
      topicContinuity: "continue",
      selfExpression: "low",
    };
  }

  it("accepts a well-formed proposal", () => {
    const result = validateResponse({
      proposal: validProposal(),
      decision: testDecision(),
      userInput: "你好",
      recentConversation: [],
    });
    expect(result.passed).toBe(true);
  });

  it("rejects a raw (non-Proposal) response field at schema stage", () => {
    const bad = validProposal() as unknown as Record<string, unknown>;
    bad["response"] = "raw string — not a proposal";
    const result = validateResponse({
      proposal: bad as unknown as LLMProposal,
      decision: testDecision(),
      userInput: "你好",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("schema");
  });

  it("rejects an empty response string", () => {
    const bad = validProposal();
    (bad as { response: Proposal<string> }).response = asProposal("");
    const result = validateResponse({
      proposal: bad,
      decision: testDecision(),
      userInput: "你好",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
  });

  it("rejects a missing field", () => {
    const bad = validProposal() as unknown as Record<string, unknown>;
    delete bad["behavior"];
    const result = validateResponse({
      proposal: bad as unknown as LLMProposal,
      decision: testDecision(),
      userInput: "你好",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("schema");
  });
});

describe("I-016: orchestrator holds no persistence capability", () => {
  it("the orchestrator module imports no repository or transaction types", async () => {
    // Structural assertion: read the orchestrator source and assert it
    // contains no persistence imports. This complements dependency-cruiser.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "src/conversation/orchestrator.ts"), "utf8");
    expect(src).not.toMatch(/Repository/);
    expect(src).not.toMatch(/TransactionManager/);
    expect(src).not.toMatch(/\.save\(/);
    expect(src).not.toMatch(/drizzle|pg-pool|Pool/);
  });
});
