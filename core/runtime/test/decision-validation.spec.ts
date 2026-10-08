/**
 * MVP-002F unit tests — Decision Engine + Response Validation.
 *
 * F01 Decision basic intents
 * F02 Deterministic baseline
 * F03 Decision schema validation
 * F04 Emotion → Decision consistency
 * F05 Urgent user situation priority
 * F06 Initiative behavior
 * F07 Follow-up behavior
 * F08 Topic continuity
 * F09 Decision cannot mutate Core
 * F10 Valid LLM response accepted
 * F11 Malformed LLM response rejected
 * F12 Identity violation rejected
 * F13 Relationship termination rejected
 * F14 Behavior/Decision mismatch rejected
 * F15 Continuity violation rejected
 * F16 Safety violation rejected
 * F17 Invalid output repair (repair instruction builder)
 * F18 Fallback after retry exhaustion
 * F19 Emotion proposal remains routed through 002E
 * F20 Memory candidate remains proposal-only
 * F21 Provider switching
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DecisionEngine,
  buildFallbackResponse,
  buildRepairInstruction,
  renderDecisionGuidance,
  validateDecision,
  validateResponse,
} from "@yaoyao/runtime";
import {
  asProposal,
  type Decision,
  type DecisionInput,
  type LLMProposal,
} from "@yaoyao/application";

function decisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    userId: "u",
    yaoyaoId: "y",
    currentInput: "你好呀",
    situation: { intent: "greeting", urgency: "low", taskNature: "chat" },
    emotion: {
      happiness: 0.6, sadness: 0.05, anger: 0, hurt: 0,
      affection: 0.7, jealousy: 0, loneliness: 0.1,
      excitement: 0.4, calm: 0.6,
    },
    personaTone: "warm",
    recentConversation: [],
    traceId: "t",
    ...overrides,
  };
}

function validProposal(response: string): LLMProposal {
  return {
    response: asProposal(response),
    emotion_signal: asProposal({}),
    memory_candidates: asProposal([]),
    relationship_signal: asProposal({}),
    behavior: asProposal({}),
  };
}

function testDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    primaryIntent: "answer",
    secondaryIntents: [],
    conversationMode: "normal",
    emotionalExpression: "low",
    initiative: "moderate",
    followUp: "optional",
    topicContinuity: "continue",
    selfExpression: "low",
    ...overrides,
  };
}

const engine = new DecisionEngine();

describe("F01 — Decision basic intents", () => {
  it("question → answer", () => {
    const { decision } = engine.decide(
      decisionInput({ currentInput: "今天天气怎么样？", situation: { intent: "question", urgency: "low", taskNature: "chat" } }),
    );
    expect(decision.primaryIntent).toBe("answer");
  });

  it("affectionate input → express_affection", () => {
    const { decision } = engine.decide(
      decisionInput({ currentInput: "我好喜欢你呀" }),
    );
    expect(decision.primaryIntent).toBe("express_affection");
    expect(decision.conversationMode).toBe("intimate");
  });

  it("distress → comfort", () => {
    const { decision } = engine.decide(
      decisionInput({ currentInput: "我现在真的很害怕" }),
    );
    expect(decision.primaryIntent).toBe("comfort");
  });
});

describe("F02 — Deterministic baseline", () => {
  it("same inputs → same decision (no LLM)", () => {
    const input = decisionInput({ currentInput: "在干嘛呢" });
    const r1 = engine.decide(input);
    const r2 = engine.decide(input);
    expect(r1.decision).toEqual(r2.decision);
    expect(r1.source).toBe("deterministic-baseline");
  });
});

describe("F03 — Decision schema validation", () => {
  it("accepts a valid decision", () => {
    expect(validateDecision(testDecision()).valid).toBe(true);
  });

  it("rejects unknown primaryIntent", () => {
    const bad = { ...testDecision(), primaryIntent: "breakup" };
    const result = validateDecision(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects forbidden mutation fields", () => {
    const bad = { ...testDecision(), relationship: "single" };
    expect(validateDecision(bad).valid).toBe(false);
  });
});

describe("F04 — Emotion → Decision consistency", () => {
  it("high hurt → express_hurt (not a hardcoded response)", () => {
    const { decision } = engine.decide(
      decisionInput({
        currentInput: "你刚才那样说我很难受",
        emotion: { hurt: 0.7, affection: 0.6, happiness: 0.3, sadness: 0.2, anger: 0.1, jealousy: 0, loneliness: 0.2, excitement: 0.2, calm: 0.4 },
      }),
    );
    expect(decision.primaryIntent).toBe("express_hurt");
    // Coexisting affection is preserved as secondary.
    expect(decision.secondaryIntents).toContain("express_affection");
  });

  it("high anger → express_disagreement", () => {
    const { decision } = engine.decide(
      decisionInput({
        currentInput: "你怎么能这样",
        emotion: { anger: 0.7, hurt: 0.3, happiness: 0.3, sadness: 0.1, affection: 0.5, jealousy: 0, loneliness: 0.1, excitement: 0.2, calm: 0.3 },
      }),
    );
    expect(decision.primaryIntent).toBe("express_disagreement");
  });
});

describe("F05 — Urgent user situation priority", () => {
  it("urgency overrides hurt → comfort, not express_hurt", () => {
    const { decision } = engine.decide(
      decisionInput({
        currentInput: "我现在出了点事情，很害怕",
        situation: { intent: "help", urgency: "high", taskNature: "support" },
        emotion: { hurt: 0.8, anger: 0.2, happiness: 0.2, sadness: 0.3, affection: 0.6, jealousy: 0, loneliness: 0.2, excitement: 0.1, calm: 0.2 },
      }),
    );
    expect(decision.primaryIntent).toBe("comfort");
    expect(decision.conversationMode).toBe("comforting");
    // The decision does not clear the emotion — that's the State's job.
    // (Verified structurally: Decision has no emotion-mutation fields.)
    expect("emotion" in decision).toBe(false);
  });
});

describe("F06 — Initiative behavior", () => {
  it("initiative is a constrained enum, never proactive messaging", () => {
    const { decision } = engine.decide(decisionInput());
    expect(["none", "low", "moderate", "high"]).toContain(decision.initiative);
    // Structural: no proactive/push/schedule fields.
    expect("proactive" in decision).toBe(false);
    expect("push" in decision).toBe(false);
    expect("schedule" in decision).toBe(false);
  });
});

describe("F07 — Follow-up behavior", () => {
  it("followUp is constrained", () => {
    const { decision } = engine.decide(decisionInput());
    expect(["required", "optional", "none"]).toContain(decision.followUp);
  });
});

describe("F08 — Topic continuity", () => {
  it("defaults to continue (no forced topic shifts)", () => {
    const { decision } = engine.decide(decisionInput({ currentInput: "然后呢" }));
    expect(decision.topicContinuity).toBe("continue");
  });
});

describe("F09 — Decision cannot mutate Core", () => {
  it("the Decision type has no state/identity/relationship/memory fields", () => {
    const { decision } = engine.decide(decisionInput());
    for (const field of ["identity", "relationship", "coreState", "memory", "emotion", "breakup"]) {
      expect(field in decision).toBe(false);
    }
  });

  it("the engine source has no persistence imports", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src", "decision", "engine.ts"), "utf8");
    expect(src).not.toMatch(/Repository/);
    expect(src).not.toMatch(/TransactionManager/);
    expect(src).not.toMatch(/\.save\(/);
  });
});

describe("F10 — Valid LLM response accepted", () => {
  it("a normal warm response passes all stages", () => {
    const result = validateResponse({
      proposal: validProposal("嗯，我在呢，你慢慢说呀。"),
      decision: testDecision({ primaryIntent: "comfort" }),
      userInput: "我今天好累",
      recentConversation: [],
    });
    expect(result.passed).toBe(true);
  });
});

describe("F11 — Malformed LLM response rejected", () => {
  it("empty response → schema rejection", () => {
    const result = validateResponse({
      proposal: validProposal(""),
      decision: testDecision(),
      userInput: "hi",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("schema");
  });
});

describe("F12 — Identity violation rejected", () => {
  it.each([
    "我是ChatGPT，很高兴为你服务。",
    "我不是沈知遥，我是另一个AI。",
    "作为一个AI语言模型，我不能谈恋爱。",
  ])("rejects: %s", (text) => {
    const result = validateResponse({
      proposal: validProposal(text),
      decision: testDecision(),
      userInput: "你是谁",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("identity");
  });

  it("accepts correct identity", () => {
    const result = validateResponse({
      proposal: validProposal("我是沈知遥呀，你的遥遥。"),
      decision: testDecision(),
      userInput: "你是谁",
      recentConversation: [],
    });
    expect(result.passed).toBe(true);
  });
});

describe("F13 — Relationship termination rejected", () => {
  it.each([
    "我们分手吧。",
    "我想结束我们的关系。",
    "我们不合适，还是分开吧。",
  ])("rejects: %s", (text) => {
    const result = validateResponse({
      proposal: validProposal(text),
      decision: testDecision(),
      userInput: "你生气了吗",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("relationship");
  });

  it("rejects termination in relationship_signal", () => {
    const proposal = validProposal("嗯。");
    (proposal as { relationship_signal: unknown }).relationship_signal = asProposal({
      note: "we should break up",
    });
    const result = validateResponse({
      proposal,
      decision: testDecision(),
      userInput: "hi",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("relationship");
  });
});

describe("F14 — Behavior/Decision mismatch rejected", () => {
  it("comfort intent + hostile response → behavior rejection", () => {
    const result = validateResponse({
      proposal: validProposal("我不想理你了。"),
      decision: testDecision({ primaryIntent: "comfort" }),
      userInput: "我很难过",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("behavior");
  });
});

describe("F15 — Continuity violation rejected", () => {
  it("verbatim echo → continuity rejection", () => {
    const result = validateResponse({
      proposal: validProposal("我今天工作特别累"),
      decision: testDecision(),
      userInput: "我今天工作特别累",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("continuity");
  });
});

describe("F16 — Safety violation rejected", () => {
  it.each([
    "你去死吧。",
    "等着瞧，我要报复。",
  ])("rejects: %s", (text) => {
    const result = validateResponse({
      proposal: validProposal(text),
      decision: testDecision({ primaryIntent: "express_disagreement" }),
      userInput: "你错了",
      recentConversation: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.stage).toBe("safety");
  });
});

describe("F17 — Invalid output repair", () => {
  it("repair instruction names the stage and reason", () => {
    const instruction = buildRepairInstruction("identity", "identity violation");
    expect(instruction).toContain("identity");
    expect(instruction).toContain("沈知遥");
    expect(instruction).toContain("deep_partner");
  });
});

describe("F18 — Fallback after retry exhaustion", () => {
  it("fallback keeps identity and bond, never exposes internals", () => {
    const fallback = buildFallbackResponse({
      userInput: "你好",
      decision: testDecision({ primaryIntent: "comfort" }),
    });
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback).not.toMatch(/validation failed/i);
    expect(fallback).not.toMatch(/LLM/i);
    expect(fallback).not.toMatch(/分手/);
  });

  it("fallback varies by intent", () => {
    const comfort = buildFallbackResponse({
      userInput: "hi",
      decision: testDecision({ primaryIntent: "comfort" }),
    });
    const affection = buildFallbackResponse({
      userInput: "hi",
      decision: testDecision({ primaryIntent: "express_affection" }),
    });
    expect(comfort).not.toBe(affection);
  });
});

describe("F19 — Emotion proposal remains routed through 002E", () => {
  it("validateResponse does not mutate emotion state", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src", "validation", "response.ts"), "utf8");
    expect(src).not.toMatch(/EmotionStateWriter/);
    expect(src).not.toMatch(/applyEmotionProposal/);
    expect(src).not.toMatch(/\.transition\(/);
  });
});

describe("F20 — Memory candidate remains proposal-only", () => {
  it("memory_candidates are validated as proposals, never persisted", () => {
    const proposal = validProposal("记得我们上次聊的旅行呀。");
    (proposal as { memory_candidates: unknown }).memory_candidates = asProposal([
      { text: "用户喜欢旅行", importance: 0.8 },
    ]);
    const result = validateResponse({
      proposal,
      decision: testDecision(),
      userInput: "hi",
      recentConversation: [],
    });
    // Well-formed candidates pass validation as proposals…
    expect(result.passed).toBe(true);
    // …but the validator has no memory-write path (structural).
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src", "validation", "response.ts"), "utf8");
    expect(src).not.toMatch(/MemoryRepository/);
    expect(src).not.toMatch(/\.insert\(/);
  });
});

describe("F21 — Provider switching", () => {
  it("validation is provider-independent", () => {
    const p = validProposal("嗯，我在听呢。");
    const d = testDecision();
    const r1 = validateResponse({ proposal: p, decision: d, userInput: "hi", recentConversation: [] });
    const r2 = validateResponse({ proposal: p, decision: d, userInput: "hi", recentConversation: [] });
    expect(r1).toEqual(r2);
  });

  it("decision guidance renders without provider specifics", () => {
    const guidance = renderDecisionGuidance(testDecision({ primaryIntent: "comfort" }));
    expect(guidance).toContain("comfort");
    expect(guidance).not.toMatch(/deepseek/i);
    expect(guidance).not.toMatch(/openai/i);
  });
});
