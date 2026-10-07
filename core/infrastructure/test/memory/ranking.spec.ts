/**
 * MVP-002D unit tests — ranking, conflict, projection (pure functions).
 *
 * D01 Relevant Memory: relevant memories are retrieved and ranked.
 * D02 Irrelevant Memory: irrelevant memories rank lower.
 * D03 Importance: higher importance wins when relevance is similar.
 * D04 Recency: freshness factor decays with age.
 * D05 Relationship Factor: SHARED_LIFE gets the relationship boost.
 * D06 Confidence: low confidence → lower score + hedged projection.
 * D07 Conflict: supersedes chains deduped; near-duplicates dropped.
 * D12 Projection: summaries contain no IDs/embeddings/scores/audit fields.
 * D13 Budget: maxSelected caps the output.
 * D15 Restart: deterministic — same input → same output, tie-break by ID.
 */
import { describe, expect, it } from "vitest";
import {
  buildQueryText,
  DEFAULT_RANKING_WEIGHTS,
  dedupeSupersedesChains,
  dropNearDuplicates,
  projectSummary,
  rankAndSelect,
  recencyFactor,
  scoreCandidate,
  type RankingCandidate,
} from "@yaoyao/infrastructure";

const W = DEFAULT_RANKING_WEIGHTS;
const NOW = new Date("2026-10-07T12:00:00Z");

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    memoryId: "mem-1",
    content: "用户喜欢喝咖啡",
    type: "SEMANTIC",
    importance: 0.8,
    confidence: 0.9,
    status: "CONSOLIDATED",
    version: 1,
    supersedes: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-10-06T00:00:00Z"),
    semanticScore: null,
    ...overrides,
  };
}

describe("D01 — Relevant memory is retrieved and ranked", () => {
  it("a keyword-matching memory outranks a non-matching one", () => {
    const relevant = candidate({ memoryId: "mem-rel", content: "用户喜欢喝拿铁咖啡" });
    const irrelevant = candidate({ memoryId: "mem-irr", content: "用户昨天去公园散步" });
    const ranked = rankAndSelect([irrelevant, relevant], "我想喝咖啡", W, NOW, 5);
    expect(ranked[0].memoryId).toBe("mem-rel");
    expect(ranked[0].signals.relevance).toBeGreaterThan(
      ranked[1].signals.relevance,
    );
  });

  it("buildQueryText combines input + situation + recent conversation", () => {
    const q = buildQueryText({
      currentInput: "我们去哪家咖啡店？",
      situation: { intent: "chat", urgency: "normal", taskNature: "general" },
      relationshipContext: { type: "deep_partner", status: "active" },
      recentConversation: ["昨天聊了旅行"],
    });
    expect(q).toContain("我们去哪家咖啡店？");
    expect(q).toContain("昨天聊了旅行");
    // Not just the raw user input.
    expect(q.length).toBeGreaterThan("我们去哪家咖啡店？".length);
  });
});

describe("D02 — Irrelevant memory ranks lower", () => {
  it("zero keyword overlap → relevance 0 → ranked last", () => {
    const a = candidate({ memoryId: "a", content: "完全不相关的内容 about 天气" });
    const b = candidate({ memoryId: "b", content: "用户喜欢喝咖啡" });
    const ranked = rankAndSelect([a, b], "咖啡", W, NOW, 5);
    expect(ranked[ranked.length - 1].memoryId).toBe("a");
    expect(ranked.find((r) => r.memoryId === "a")!.signals.relevance).toBe(0);
  });
});

describe("D03 — Importance breaks ties", () => {
  it("higher importance wins when relevance is equal", () => {
    const low = candidate({ memoryId: "low", content: "用户喜欢咖啡", importance: 0.3 });
    const high = candidate({ memoryId: "high", content: "用户喜欢咖啡", importance: 0.9 });
    const ranked = rankAndSelect([low, high], "咖啡", W, NOW, 5);
    expect(ranked[0].memoryId).toBe("high");
  });
});

describe("D04 — Recency (freshness factor)", () => {
  it("newer memories get a higher recency factor", () => {
    const fresh = recencyFactor(new Date("2026-10-06T00:00:00Z"), NOW, 180);
    const old = recencyFactor(new Date("2025-10-07T00:00:00Z"), NOW, 180);
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeLessThanOrEqual(1);
    // Freshness alone doesn't dominate: an old, important, relevant memory
    // can still outrank a fresh irrelevant one.
    const oldImportant = candidate({
      memoryId: "old",
      content: "用户喜欢咖啡",
      importance: 0.95,
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });
    const freshIrrelevant = candidate({
      memoryId: "fresh",
      content: "今天天气不错",
      importance: 0.5,
      updatedAt: NOW,
    });
    const ranked = rankAndSelect([freshIrrelevant, oldImportant], "咖啡", W, NOW, 5);
    expect(ranked[0].memoryId).toBe("old");
  });
});

describe("D05 — Relationship factor", () => {
  it("SHARED_LIFE gets a boost over SEMANTIC when otherwise equal", () => {
    const semantic = candidate({ memoryId: "sem", type: "SEMANTIC", content: "用户喜欢喝咖啡" });
    const shared = candidate({ memoryId: "shared", type: "SHARED_LIFE", content: "你们一起喝咖啡" });
    const ranked = rankAndSelect([semantic, shared], "咖啡", W, NOW, 5);
    expect(ranked[0].memoryId).toBe("shared");
    expect(ranked[0].signals.relationship).toBeGreaterThan(
      ranked[1].signals.relationship,
    );
  });
});

describe("D06 — Confidence", () => {
  it("low confidence lowers the score and hedges the projection", () => {
    const confident = candidate({ memoryId: "c", content: "用户喜欢喝咖啡每天一杯", confidence: 0.95 });
    const unsure = candidate({ memoryId: "u", content: "用户好像提过喜欢喝咖啡", confidence: 0.2 });
    const ranked = rankAndSelect([unsure, confident], "咖啡", W, NOW, 5);
    expect(ranked[0].memoryId).toBe("c");
    const hedged = projectSummary(
      ranked.find((r) => r.memoryId === "u")!,
      W,
      200,
    );
    const plain = projectSummary(
      ranked.find((r) => r.memoryId === "c")!,
      W,
      200,
    );
    expect(hedged).toContain("可能");
    expect(plain).not.toContain("可能");
  });
});

describe("D07 — Conflict handling", () => {
  it("supersedes chains keep only the newest version", () => {
    const old = candidate({ memoryId: "old", content: "用户喜欢喝咖啡", version: 1 });
    const newer = candidate({
      memoryId: "new",
      content: "用户不再喝咖啡",
      version: 2,
      supersedes: "old",
    });
    const scored = [old, newer].map((c) => scoreCandidate(c, "", W, NOW));
    const deduped = dedupeSupersedesChains(scored);
    expect(deduped.map((d) => d.memoryId)).toEqual(["new"]);
  });

  it("near-duplicate consolidated memories are not both served", () => {
    const a = candidate({ memoryId: "a", content: "用户喜欢喝拿铁咖啡每天早上一杯" });
    const b = candidate({ memoryId: "b", content: "用户喜欢喝拿铁咖啡每天早上一杯真的" });
    const scored = [a, b].map((c) => scoreCandidate(c, "", W, NOW));
    const filtered = dropNearDuplicates(scored, W);
    expect(filtered.length).toBe(1);
  });

  it("genuinely different memories are both kept", () => {
    const a = candidate({ memoryId: "a", content: "用户喜欢喝咖啡" });
    const b = candidate({ memoryId: "b", content: "用户下周要去日本旅行" });
    const scored = [a, b].map((c) => scoreCandidate(c, "", W, NOW));
    const filtered = dropNearDuplicates(scored, W);
    expect(filtered.length).toBe(2);
  });
});

describe("D12 — Projection is model-safe", () => {
  it("summaries contain no IDs, embeddings, scores, or audit fields", () => {
    const c = candidate({
      memoryId: "550e8400-e29b-41d4-a716-446655440000",
      content: "用户喜欢喝咖啡",
      type: "SHARED_LIFE",
    });
    const scored = scoreCandidate(c, "", W, NOW);
    const summary = projectSummary(scored, W, 200);
    expect(summary).not.toContain("550e8400");
    expect(summary).not.toContain("embedding");
    expect(summary).not.toContain("score");
    expect(summary).not.toContain("user_id");
    expect(summary).not.toContain("created_at");
    expect(summary).toContain("用户喜欢喝咖啡");
  });

  it("type prefixes frame the memory for the model", () => {
    const shared = scoreCandidate(candidate({ type: "SHARED_LIFE", content: "一起去旅行" }), "", W, NOW);
    const semantic = scoreCandidate(candidate({ type: "SEMANTIC", content: "喜欢咖啡" }), "", W, NOW);
    expect(projectSummary(shared, W, 200)).toContain("共同回忆");
    expect(projectSummary(semantic, W, 200)).toContain("用户提到");
  });
});

describe("D13 — Budget", () => {
  it("maxSelected caps the number of returned memories", () => {
    const topics = ["咖啡", "旅行", "音乐", "电影", "美食", "跑步", "读书", "摄影", "园艺", "钓鱼"];
    const many = topics.map((t, i) =>
      candidate({ memoryId: `m${i}`, content: `用户喜欢${t}这是第${i}条不同的记忆内容` }),
    );
    const ranked = rankAndSelect(many, "用户喜欢", W, NOW, 3);
    expect(ranked.length).toBe(3);
  });
});

describe("D15 — Determinism", () => {
  it("same inputs → same outputs, with memoryId tie-break", () => {
    const a = candidate({ memoryId: "b-id", content: "用户喜欢咖啡今天" });
    const b = candidate({ memoryId: "a-id", content: "用户喜欢咖啡明天" });
    const run1 = rankAndSelect([a, b], "咖啡", W, NOW, 5);
    const run2 = rankAndSelect([b, a], "咖啡", W, NOW, 5);
    expect(run1.map((r) => r.memoryId)).toEqual(run2.map((r) => r.memoryId));
    // Tie (identical scores) → memoryId ascending.
    expect(run1[0].memoryId).toBe("a-id");
  });
});
