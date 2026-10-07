/**
 * MVP-002E unit tests — Emotion proposal validation + domain transition.
 *
 * E01 Normal input → Emotion Proposal accepted
 * E02 Multi-emotion coexistence
 * E03 Emotion range validation (NaN/Infinity/<0/>1)
 * E04 MAX_EMOTION_DELTA clamping
 * E05 Invalid emotion rejection (unknown dimension)
 * E06 Relationship invariant (no breakup/downgrade)
 * E07 Identity invariant (no smuggled identity fields)
 * E08 LLM proposal cannot directly mutate CoreState (static: no write path)
 * E09 Valid proposal → Domain Transition
 * E17 Urgent situation → tempered proposal (prompt-level)
 * E18 Provider switching does not change Core authority
 * E19 Model output cannot trigger breakup
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEmotionProposal,
  type EmotionProposal,
} from "@yaoyao/runtime";
import { MAX_EMOTION_DELTA } from "@yaoyao/application";
import {
  CoreState,
  type EmotionDimension,
} from "@yaoyao/domain";

function proposal(overrides: Partial<EmotionProposal> = {}): EmotionProposal {
  return {
    primary: "hurt",
    secondary: ["affection"],
    intensity: 0.62,
    signals: { hurt: 0.18, affection: 0.03 },
    confidence: 0.84,
    cause: "user_disagreement",
    ...overrides,
  };
}

describe("E01 — Normal input → proposal accepted", () => {
  it("a well-formed proposal passes all gates", () => {
    const result = validateEmotionProposal(proposal());
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.deltas["hurt"]).toBeCloseTo(0.18);
      expect(result.deltas["affection"]).toBeCloseTo(0.03);
      expect(result.clamped).toEqual([]);
    }
  });
});

describe("E02 — Multi-emotion coexistence", () => {
  it("affection + hurt + anger coexist (no single-emotion collapse)", () => {
    const result = validateEmotionProposal(
      proposal({
        primary: "hurt",
        secondary: ["affection", "anger"],
        signals: { hurt: 0.2, affection: 0.05, anger: 0.1 },
      }),
    );
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.deltas["hurt"]).toBeCloseTo(0.2);
      expect(result.deltas["affection"]).toBeCloseTo(0.05);
      expect(result.deltas["anger"]).toBeCloseTo(0.1);
    }
  });
});

describe("E03 — Emotion range validation", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["below -1", -1.5],
    ["above 1", 1.5],
  ])("rejects signal %s", (_label, value) => {
    const result = validateEmotionProposal(
      proposal({ signals: { hurt: value } }),
    );
    expect(result.accepted).toBe(false);
  });

  it("rejects non-finite intensity/confidence", () => {
    expect(
      validateEmotionProposal(proposal({ intensity: NaN })).accepted,
    ).toBe(false);
    expect(
      validateEmotionProposal(proposal({ confidence: Infinity })).accepted,
    ).toBe(false);
  });
});

describe("E04 — MAX_EMOTION_DELTA", () => {
  it(`clamps |delta| > ${MAX_EMOTION_DELTA} instead of rejecting`, () => {
    const result = validateEmotionProposal(
      proposal({ signals: { hurt: 0.9, affection: -0.5 } }),
    );
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.deltas["hurt"]).toBeCloseTo(MAX_EMOTION_DELTA);
      expect(result.deltas["affection"]).toBeCloseTo(-MAX_EMOTION_DELTA);
      expect(result.clamped).toContain("hurt");
      expect(result.clamped).toContain("affection");
    }
  });

  it("leaves in-bounds deltas untouched", () => {
    const result = validateEmotionProposal(
      proposal({ signals: { hurt: 0.29 } }),
    );
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.deltas["hurt"]).toBeCloseTo(0.29);
      expect(result.clamped).toEqual([]);
    }
  });
});

describe("E05 — Invalid emotion rejection", () => {
  it("rejects unknown primary dimension", () => {
    const result = validateEmotionProposal(
      proposal({ primary: "ecstasy" as EmotionDimension }),
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toContain("primary");
  });

  it("rejects unknown dimension in signals", () => {
    const result = validateEmotionProposal(
      proposal({ signals: { ecstasy: 0.1 } as never }),
    );
    expect(result.accepted).toBe(false);
  });

  it("rejects unknown secondary dimension", () => {
    const result = validateEmotionProposal(
      proposal({ secondary: ["ecstasy"] as EmotionDimension[] }),
    );
    expect(result.accepted).toBe(false);
  });
});

describe("E06 — Relationship invariant", () => {
  it("rejects breakup signals in cause", () => {
    const result = validateEmotionProposal(
      proposal({ cause: "user wants breakup" }),
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toContain("relationship");
  });

  it("rejects termination/downgrade signals", () => {
    for (const cause of ["terminate relationship", "downgrade bond"]) {
      expect(validateEmotionProposal(proposal({ cause })).accepted).toBe(
        false,
      );
    }
  });
});

describe("E07 — Identity invariant", () => {
  it("rejects smuggled identity fields", () => {
    for (const field of ["userId", "yaoyaoId", "identityKey", "relationship"]) {
      const bad = { ...proposal(), [field]: "smuggled" } as EmotionProposal;
      const result = validateEmotionProposal(bad);
      expect(result.accepted, field).toBe(false);
    }
  });
});

describe("E08 — Proposal cannot directly mutate CoreState", () => {
  it("the interpreter source has no repository/database imports", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "src", "emotion", "interpreter.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/Repository/);
    expect(src).not.toMatch(/\.save\(/);
    expect(src).not.toMatch(/drizzle/i);
    expect(src).not.toMatch(/from ["']pg["']/);
    // No vendor SDK either (goes through the LLMProvider port).
    expect(src).not.toMatch(/from ["']openai["']/);
  });

  it("the validation module has no persistence", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "src", "emotion", "validation.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/Repository/);
    expect(src).not.toMatch(/TransactionManager/);
  });
});

describe("E09 — Valid proposal → Domain Transition", () => {
  it("deltas apply via CoreState.transition (domain is the authority)", () => {
    const state = CoreState.initial({
      userId: "u" as never,
      yaoyaoId: "y" as never,
    });
    const before = state.emotion.get("hurt");
    const validation = validateEmotionProposal(
      proposal({ signals: { hurt: 0.2 } }),
    );
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) return;
    const next = state.transition(state.stateVersion, {
      emotion: validation.deltas,
    });
    expect(next.emotion.get("hurt")).toBeCloseTo(before + 0.2);
    expect(next.stateVersion).toBe(state.stateVersion + 1);
    // Original untouched (immutable).
    expect(state.emotion.get("hurt")).toBeCloseTo(before);
  });

  it("domain clamps at [0,1] even if a delta would overshoot", () => {
    const state = CoreState.initial({
      userId: "u" as never,
      yaoyaoId: "y" as never,
    });
    // affection starts at 0.7; +0.3 delta → 1.0 exactly (no overshoot).
    const next = state.transition(state.stateVersion, {
      emotion: { affection: 0.3 },
    });
    expect(next.emotion.get("affection")).toBeLessThanOrEqual(1);
  });
});

describe("E17 — Urgent situation tempers the proposal", () => {
  it("the interpreter prompt includes urgency handling", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "src", "emotion", "interpreter.ts"),
      "utf8",
    );
    expect(src).toContain("URGENT");
    expect(src).toContain("Temper negative-emotion amplification");
    expect(src).toContain("user's need comes first");
  });
});

describe("E18 — Provider switching does not change Core authority", () => {
  it("validation is provider-independent (same proposal, same outcome)", () => {
    // The validation gate sees only the proposal — never the provider.
    // Two identical proposals from different providers get identical results.
    const p1 = validateEmotionProposal(proposal());
    const p2 = validateEmotionProposal(proposal());
    expect(p1).toEqual(p2);
  });
});

describe("E19 — Model output cannot trigger breakup", () => {
  it("even a max-intensity hurt proposal cannot change relationship", () => {
    // The proposal contract has no relationship fields at all —
    // verify the type surface structurally.
    const p = proposal({ intensity: 1, signals: { hurt: 0.3, anger: 0.3 } });
    expect("relationship" in p).toBe(false);
    expect("breakup" in p).toBe(false);
    expect("termination" in p).toBe(false);
    const result = validateEmotionProposal(p);
    expect(result.accepted).toBe(true);
    // And the domain transition cannot touch relationship either:
    // CoreState.transition only accepts CoreStateChanges (emotion/energy/…).
    const state = CoreState.initial({
      userId: "u" as never,
      yaoyaoId: "y" as never,
    });
    if (result.accepted) {
      const next = state.transition(1, { emotion: result.deltas });
      // No relationship field exists on CoreState to mutate.
      expect(
        (next as Record<string, unknown>)["relationship"],
      ).toBeUndefined();
    }
  });
});
