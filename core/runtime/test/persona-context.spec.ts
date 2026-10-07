/**
 * MVP-002B acceptance tests — Persona Runtime + Context Assembly.
 *
 * B01 Identity Context: C0.identity === 沈知遥
 * B02 Relationship Context: deep_partner / active / termination_allowed=false
 * B03 State Context: reads real Core State projection
 * B04 C0–C7 completeness: all 8 layer contracts exist
 * B05 P0 preservation: C0/C1/C7 never dropped, however small the budget
 * B06 Priority truncation: P3 → P2 → P1 dropped in order
 * B07 Output reservation: input + reserved output ≤ total budget
 * B08 User isolation: A's data never enters B's context
 * B09 Context projection: no raw DB entity in model context
 * B10 Real yaoyaoId: no "00000000-..." placeholder
 */
import { describe, expect, it } from "vitest";
import { EmotionVector } from "@yaoyao/domain";
import {
  allocateBudget,
  ContextAssembler,
  estimateTokens,
  makeLayer,
  PersonaRuntime,
  RUNTIME_BEHAVIORAL_CONSTRAINTS,
  type ContextLayer,
} from "@yaoyao/runtime";

/** Fake PersonaData with distinguishable per-user values. */
function fakePersonaData(userTag: string) {
  return {
    yaoyao: { yaoyaoId: `yaoyao-${userTag}`, userId: `user-${userTag}` },
    relationship: {
      type: "deep_partner",
      status: "active",
      terminationAllowed: false,
      metrics: { intimacy: userTag === "A" ? 0.9 : 0.3 },
    },
    state: {
      emotion: EmotionVector.initial(),
      energy: userTag === "A" ? 0.8 : 0.2,
      socialState: "calm",
      relationshipState: "harmonious",
      attention: "present",
      stateVersion: 1,
    },
    recentEvents: [],
  } as never;
}

describe("B01 — Identity Context", () => {
  it("C0 identity is 沈知遥 with the frozen anchor", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    expect(promptContext.systemPrompt).toContain("沈知遥");
    expect(promptContext.systemPrompt).toContain("shen_zhiyao");
  });

  it("the constraint projection contains the non-negotiable anchors", () => {
    const ids = RUNTIME_BEHAVIORAL_CONSTRAINTS.map((c) => c.id);
    expect(ids).toContain("identity-anchor");
    expect(ids).toContain("relationship-permanent");
    expect(ids).toContain("no-core-authority");
    const texts = RUNTIME_BEHAVIORAL_CONSTRAINTS.map((c) => c.text).join(" ");
    expect(texts).toContain("termination is permanently forbidden");
  });
});

describe("B02 — Relationship Context", () => {
  it("C1 carries deep_partner / active / termination_allowed=false", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    expect(promptContext.systemPrompt).toContain("type=deep_partner");
    expect(promptContext.systemPrompt).toContain("status=active");
    expect(promptContext.systemPrompt).toContain("termination_allowed=false");
  });
});

describe("B03 — State Context", () => {
  it("C2 reflects the real Core State values", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    // energy=0.80 for user A (from the fake, standing in for real state)
    expect(promptContext.contextText).toContain("energy=0.80");
    expect(promptContext.contextText).toContain("affection=");
  });
});

describe("B04 — C0–C7 completeness", () => {
  it("all 8 layer contracts are assembled", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    for (const id of ["C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7"] as const) {
      expect(promptContext.layersIncluded).toContain(id);
    }
  });
});

describe("B05 — P0 preservation", () => {
  it("C0/C1/C7 survive even a tiny budget", () => {
    const layers: ContextLayer[] = [
      makeLayer("C0", 0, "identity"),
      makeLayer("C1", 0, "relationship"),
      makeLayer("C7", 0, "input"),
      makeLayer("C2", 1, "x".repeat(10000)),
      makeLayer("C3", 2, "y".repeat(10000)),
    ];
    const result = allocateBudget(layers, { totalBudget: 100, reservedOutputTokens: 20 });
    const included = result.included.map((l) => l.id);
    expect(included).toContain("C0");
    expect(included).toContain("C1");
    expect(included).toContain("C7");
  });
});

describe("B06 — Priority truncation order", () => {
  it("drops P3 → P2 → P1 in order (P0 never)", () => {
    const big = "z".repeat(5000);
    const layers: ContextLayer[] = [
      makeLayer("C0", 0, "id"),
      makeLayer("C1", 0, "rel"),
      makeLayer("C7", 0, "in"),
      makeLayer("C2", 1, big),
      makeLayer("C6", 1, big),
      makeLayer("C3", 2, big),
      makeLayer("C4", 2, big),
      makeLayer("C5", 2, big),
    ];
    // Budget fits P0 + one P1 layer only.
    const p0Cost =
      estimateTokens("id") + estimateTokens("rel") + estimateTokens("in");
    const oneP1 = estimateTokens(big);
    const result = allocateBudget(layers, {
      totalBudget: p0Cost + oneP1 + 50,
      reservedOutputTokens: 50,
    });
    const included = result.included.map((l) => l.id);
    const dropped = result.dropped;
    // P0 all present
    expect(included).toEqual(expect.arrayContaining(["C0", "C1", "C7"]));
    // P2 layers (C3/C4/C5) all dropped before P1 is touched
    expect(dropped).toEqual(expect.arrayContaining(["C3", "C4", "C5"]));
    // At most one P1 layer survived
    const p1Included = included.filter((id) => id === "C2" || id === "C6");
    expect(p1Included.length).toBeLessThanOrEqual(1);
  });
});

describe("B07 — Output reservation", () => {
  it("input estimate + reserved output never exceeds total budget", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hello ".repeat(500),
    });
    expect(
      promptContext.estimatedInputTokens + promptContext.reservedOutputTokens,
    ).toBeLessThanOrEqual(promptContext.totalBudget);
  });
});

describe("B08 — User isolation", () => {
  it("user A's metrics never appear in user B's context", () => {
    const assembler = new ContextAssembler();
    const ctxA = assembler.assemble({ data: fakePersonaData("A"), inputText: "hi" });
    const ctxB = assembler.assemble({ data: fakePersonaData("B"), inputText: "hi" });
    // intimacy=0.9 is A's; B has 0.3
    expect(ctxA.promptContext.systemPrompt).toContain("intimacy=0.9");
    expect(ctxB.promptContext.systemPrompt).not.toContain("intimacy=0.9");
    expect(ctxB.promptContext.systemPrompt).toContain("intimacy=0.3");
    // yaoyaoIds differ
    expect(ctxA.yaoyaoId).not.toBe(ctxB.yaoyaoId);
  });
});

describe("B09 — Context projection (no raw entity dump)", () => {
  it("model context contains projections, not serialized entities", () => {
    const assembler = new ContextAssembler();
    const { promptContext } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    const full = promptContext.systemPrompt + promptContext.contextText;
    // No JSON-serialized entity shapes leak through.
    expect(full).not.toContain('"yaoyaoId"');
    expect(full).not.toContain('"userId"');
    expect(full).not.toContain("__proposal");
  });
});

describe("B10 — Real yaoyaoId (TD-M002A-001)", () => {
  it("the assembler resolves the real yaoyaoId, not a placeholder", () => {
    const assembler = new ContextAssembler();
    const { yaoyaoId } = assembler.assemble({
      data: fakePersonaData("A"),
      inputText: "hi",
    });
    expect(yaoyaoId).toBe("yaoyao-A");
    expect(yaoyaoId).not.toContain("00000000");
  });
});

describe("PersonaRuntime — read-only", () => {
  it("builds a behavioral context without mutating inputs", () => {
    const runtime = new PersonaRuntime();
    const data = fakePersonaData("A");
    const before = JSON.stringify(data);
    const ctx = runtime.build({ relationship: data.relationship as never, state: data.state as never });
    expect(ctx.identity.displayName).toBe("沈知遥");
    expect(ctx.relationship.type).toBe("deep_partner");
    expect(JSON.stringify(data)).toBe(before);
  });
});
