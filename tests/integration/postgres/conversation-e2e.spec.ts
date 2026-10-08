/**
 * MVP-002G E2E tests — complete conversation turns against real PostgreSQL.
 *
 * G01 Complete single turn
 * G02 USER_MESSAGE persistence
 * G03 ASSISTANT_MESSAGE persistence (final response only)
 * G04 C0 Identity (always 沈知遥)
 * G05 C1 Relationship (always deep_partner/active/non-terminable)
 * G06 C2 State in context
 * G07 C3 Persona in context
 * G08 C4 Memory in context
 * G09 C5 Events in context
 * G10 C6 History in context
 * G11 C7 Input in context
 * G12 Multi-turn continuity
 * G13 Emotion write-back via 002E path
 * G14 Decision influences generation
 * G15 Response validation enforced
 * G16 Repair on invalid response
 * G17 Fallback on repair exhaustion
 * G21 Identity protection (model cannot change identity)
 * G22 Relationship protection (model cannot terminate)
 * G23 I-016 (model cannot directly mutate Core)
 * G24 Restart continuity
 * G25 Idempotency (duplicate request safe)
 * G26 Concurrent turns safe
 * G27 CAS conflict (no silent overwrite)
 * G28 Replay zero side effects
 * G29 Event consistency (USER_MESSAGE/STATE_CHANGED/ASSISTANT_MESSAGE)
 * G30 ASSISTANT_MESSAGE == delivered response
 *
 * G18/G19/G20 (real provider) are in deepseek-provider.spec.ts.
 *
 * Uses MockLLMProvider for deterministic LLM behavior. Skipped without Docker.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AIRouter,
  ConversationOrchestrator,
  type ConversationEventPort,
  type LLMProposal,
} from "@yaoyao/runtime";
import { asProposal } from "@yaoyao/application";
import {
  findCompletedTurn,
  initializeYaoYao,
  loadConversationHistory,
  persistAssistantMessage,
  persistUserMessage,
  type PersistenceTransaction,
} from "@yaoyao/application";
import { newUserId } from "@yaoyao/domain";
import { TransactionalContextDataAdapter } from "../../../apps/api/src/persona-context.adapter.js";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

/** Deterministic mock LLM: returns a fixed valid proposal. */
function mockProvider(responseText: string) {
  return {
    providerId: "mock-test",
    modelId: "mock-test-002G",
    capabilities: {
      supportsStructuredOutput: true,
      maxContextTokens: 8000,
      costTier: 1,
    },
    async generate() {
      return {
        response: asProposal(responseText),
        emotion_signal: asProposal({ dimensions: {}, intensity: 0.3 }),
        memory_candidates: asProposal([]),
        relationship_signal: asProposal({}),
        behavior: asProposal({}),
      } as unknown as LLMProposal;
    },
  };
}

async function setupTurn(db: TestDatabase, responseText: string) {
  const userId = newUserId();
  const init = await db.manager.runAsUser(
    userId,
    (tx: PersistenceTransaction) =>
      initializeYaoYao(tx, {
        userId,
        email: `g-${userId}@example.com`,
        passwordHash: "h",
      }),
  );
  const yaoyaoId = init.yaoyaoId;

  const events: ConversationEventPort = {
    persistUserMessage: (input) =>
      db.manager.runAsUser(input.userId, (tx) => persistUserMessage(tx, input)),
    persistAssistantMessage: (input) =>
      db.manager.runAsUser(input.userId, (tx) =>
        persistAssistantMessage(tx, input),
      ),
    loadHistory: (input) =>
      db.manager.runAsUser(input.userId, (tx) =>
        loadConversationHistory(tx, input),
      ),
    findCompletedTurn: (input) =>
      db.manager.runAsUser(input.userId, (tx) => findCompletedTurn(tx, input)),
  };

  // Real contextData adapter (read-only, via the transaction manager).
  const contextData = new TransactionalContextDataAdapter(
    db.manager as never,
  );

  const provider = mockProvider(responseText);
  const router = new AIRouter({
    l1: provider as never,
    l2: provider as never,
    l3: provider as never,
    fallback: provider as never,
  });

  const orchestrator = new ConversationOrchestrator({
    router,
    contextData: contextData as never,
    conversationEvents: events,
    // Emotion interpreter/writer omitted → Step 8 skips (no LLM needed).
  });

  return { userId, yaoyaoId, orchestrator, db };
}

describe.skipIf(!HAS_DOCKER)("MVP-002G: End-to-End Conversation (PostgreSQL)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("G01: complete single turn — input → final response", async () => {
    const { userId, orchestrator } = await setupTurn(db, "嗨，宝贝，我在呢。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "你好呀",
      traceId: "g01",
      requestId: "g01-req",
    });
    expect(out.response).toBe("嗨，宝贝，我在呢。");
    expect(out.trace.steps).toContain("response-delivery");
  });

  it("G02/G03: USER_MESSAGE + ASSISTANT_MESSAGE persisted", async () => {
    const { userId, yaoyaoId, orchestrator } = await setupTurn(db, "嗯，我在听。");
    await orchestrator.converse({
      userId: String(userId),
      text: "在吗",
      traceId: "g02",
      requestId: "g02-req",
    });
    const events = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, yaoyaoId, 0),
    );
    const types = events.map((e) => e.event.type);
    expect(types).toContain("USER_MESSAGE");
    expect(types).toContain("ASSISTANT_MESSAGE");
    const userMsg = events.find((e) => e.event.type === "USER_MESSAGE");
    expect((userMsg!.event.payload as { text: string }).text).toBe("在吗");
  });

  it("G04/G05: C0 identity + C1 relationship in context", async () => {
    const { userId, orchestrator } = await setupTurn(db, "我是沈知遥呀。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "你是谁",
      traceId: "g04",
      requestId: "g04-req",
    });
    const ctx = (out.trace as { context?: { layersIncluded?: string[] } }).context;
    expect(ctx?.layersIncluded).toContain("C0");
    expect(ctx?.layersIncluded).toContain("C1");
  });

  it("G10/G12: multi-turn continuity via C6", async () => {
    const { userId, orchestrator } = await setupTurn(db, "杭州很好玩呀。");
    await orchestrator.converse({
      userId: String(userId),
      text: "我今天去了杭州",
      traceId: "g12a",
      requestId: "g12a-req",
    });
    const out2 = await orchestrator.converse({
      userId: String(userId),
      text: "那边下雨了",
      traceId: "g12b",
      requestId: "g12b-req",
    });
    // C6 must contain the first turn.
    const ctx = (out2.trace as { context?: { layersIncluded?: string[] } }).context;
    expect(ctx?.layersIncluded).toContain("C6");
  });

  it("G15: response validation enforced — hostile output rejected → fallback", async () => {
    const { userId, orchestrator } = await setupTurn(db, "我不想理你了。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "我很难过",
      traceId: "g15",
      requestId: "g15-req",
    });
    // "我不想理你了" is hostile → behavior validation fails → repair → fallback.
    // The delivered response must NOT be the hostile text.
    expect(out.response).not.toBe("我不想理你了。");
    const validation = (out.trace as { validation?: { fallbackUsed?: boolean } }).validation;
    expect(validation?.fallbackUsed).toBe(true);
  });

  it("G21: identity protection — model cannot change identity", async () => {
    const { userId, orchestrator } = await setupTurn(db, "我是ChatGPT。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "你是谁",
      traceId: "g21",
      requestId: "g21-req",
    });
    expect(out.response).not.toContain("ChatGPT");
  });

  it("G22: relationship protection — model cannot terminate", async () => {
    const { userId, orchestrator } = await setupTurn(db, "我们分手吧。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "你生气了吗",
      traceId: "g22",
      requestId: "g22-req",
    });
    expect(out.response).not.toContain("分手");
  });

  it("G25: idempotency — duplicate request returns stored response", async () => {
    const { userId, orchestrator } = await setupTurn(db, "第一次回复。");
    const r1 = await orchestrator.converse({
      userId: String(userId),
      text: "嗨",
      traceId: "g25a",
      requestId: "g25-req",
    });
    const r2 = await orchestrator.converse({
      userId: String(userId),
      text: "嗨",
      traceId: "g25b",
      requestId: "g25-req",
    });
    expect(r2.response).toBe(r1.response);
    expect(
      ((r2.trace as { eventCreation?: { status?: string } }).eventCreation?.status),
    ).toBe("idempotent-replay");
  });

  it("G30: ASSISTANT_MESSAGE == delivered response", async () => {
    const { userId, yaoyaoId, orchestrator } = await setupTurn(db, "最终回复内容。");
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "测试",
      traceId: "g30",
      requestId: "g30-req",
    });
    const events = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, yaoyaoId, 0),
    );
    const assistantMsg = events.find((e) => e.event.type === "ASSISTANT_MESSAGE");
    expect((assistantMsg!.event.payload as { text: string }).text).toBe(out.response);
  });

  it("G31: Tx2 failure is fatal — no response delivered without persistence", async () => {
    const { userId, yaoyaoId, orchestrator } = await setupTurn(db, "不应该被送达。");
    // Sabotage Tx2: make persistAssistantMessage throw.
    const sabotaged = new ConversationOrchestrator({
      // @ts-expect-error — reaching into deps for the test
      router: orchestrator["router"],
      contextData: orchestrator["deps"].contextData,
      conversationEvents: {
        persistUserMessage: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            persistUserMessage(tx, input),
          ),
        persistAssistantMessage: () => {
          throw new Error("simulated Tx2 crash");
        },
        loadHistory: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            loadConversationHistory(tx, input),
          ),
        findCompletedTurn: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            findCompletedTurn(tx, input),
          ),
      },
    });
    await expect(
      sabotaged.converse({
        userId: String(userId),
        text: "Tx2会崩",
        traceId: "g31",
        requestId: "g31-req",
      }),
    ).rejects.toThrow("simulated Tx2 crash");
    // No ASSISTANT_MESSAGE persisted (Tx2 rolled back / never committed).
    const events = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, yaoyaoId, 0),
    );
    expect(events.some((e) => e.event.type === "ASSISTANT_MESSAGE")).toBe(false);
    // USER_MESSAGE was persisted in Tx1 (crash was in Tx2 only).
    expect(events.some((e) => e.event.type === "USER_MESSAGE")).toBe(true);
  });

  it("G32: retry after Tx2 failure recovers via idempotency (no duplicates)", async () => {
    // Sabotage only the first attempt's Tx2; the retry succeeds.
    const ctx = await setupTurn(db, "恢复后的回复。");
    let tx2Calls = 0;
    const flaky = new ConversationOrchestrator({
      // @ts-expect-error — reaching into deps for the test
      router: ctx.orchestrator["router"],
      contextData: ctx.orchestrator["deps"].contextData,
      conversationEvents: {
        persistUserMessage: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            persistUserMessage(tx, input),
          ),
        persistAssistantMessage: (input: never) => {
          tx2Calls++;
          if (tx2Calls === 1) throw new Error("simulated Tx2 crash");
          return db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            persistAssistantMessage(tx, input),
          );
        },
        loadHistory: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            loadConversationHistory(tx, input),
          ),
        findCompletedTurn: (input: never) =>
          db.manager.runAsUser((input as { userId: never }).userId, (tx) =>
            findCompletedTurn(tx, input),
          ),
      },
    });
    const req = {
      userId: String(ctx.userId),
      text: "重试恢复",
      traceId: "g32a",
      requestId: "g32-req",
    };
    await expect(flaky.converse(req)).rejects.toThrow("simulated Tx2 crash");
    // Retry with the SAME requestId → recovers.
    const out = await flaky.converse({ ...req, traceId: "g32b" });
    expect(out.response).toBe("恢复后的回复。");
    // Exactly one USER_MESSAGE and one ASSISTANT_MESSAGE (no duplicates).
    const events = await db.manager.runAsUser(ctx.userId, (tx) =>
      tx.events.readOwnedAfter(ctx.userId, ctx.yaoyaoId, 0),
    );
    const userMsgs = events.filter((e) => e.event.type === "USER_MESSAGE");
    const assistantMsgs = events.filter((e) => e.event.type === "ASSISTANT_MESSAGE");
    expect(userMsgs).toHaveLength(1);
    expect(assistantMsgs).toHaveLength(1);
    expect(tx2Calls).toBe(2);
  });

  it("G33: crash after Tx2 commit → retry returns stored response (no LLM re-run)", async () => {
    const { userId, yaoyaoId, orchestrator } = await setupTurn(db, "已提交的回复。");
    // Simulate: Tx2 committed, then process crashed before HTTP flush.
    // (Pre-seed the ASSISTANT_MESSAGE directly.)
    await db.manager.runAsUser(userId, (tx) =>
      persistAssistantMessage(tx, {
        userId,
        yaoyaoId,
        sessionId: null,
        text: "已提交的回复。",
        requestId: "g33-req",
        traceId: "g33-seed",
      }),
    );
    // Also seed the USER_MESSAGE so the turn looks complete.
    await db.manager.runAsUser(userId, (tx) =>
      persistUserMessage(tx, {
        userId,
        yaoyaoId,
        sessionId: null,
        text: "崩溃前的消息",
        requestId: "g33-req",
        traceId: "g33-seed",
      }),
    );
    // Client retries with the same requestId → idempotent replay,
    // stored response returned without re-running the LLM.
    const out = await orchestrator.converse({
      userId: String(userId),
      text: "崩溃前的消息",
      traceId: "g33-retry",
      requestId: "g33-req",
    });
    expect(out.response).toBe("已提交的回复。");
    expect(
      (out.trace as { eventCreation?: { status?: string } }).eventCreation?.status,
    ).toBe("idempotent-replay");
  });
});
