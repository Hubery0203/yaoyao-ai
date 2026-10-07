/**
 * MVP-002C acceptance tests — AI Router + Provider Integration.
 *
 * C01 Mock Provider: existing mock still passes (see mock-provider.spec.ts).
 * C02 DeepSeek Adapter: request/response/error mapping (no network).
 * C03 OpenAI Adapter: request/response/error mapping (no network).
 * C04 Provider Independence: runtime never imports a vendor SDK.
 * C05 Router: L1/L2/L3 deterministic selection.
 * C06 Fallback: primary failure → fallback provider.
 * C07 Timeout: timeout causes no Core mutation (I-016 structural).
 * C08 429: retry with backoff, then fallback.
 * C09 Invalid Output: invalid JSON → retry → fallback; never to user raw.
 * C10 I-016: real provider output cannot trigger Core writes.
 * C11 API Key Security: no secret in traces, errors, or telemetry.
 * C12 Provider Switch: DeepSeek → OpenAI preserves identity/relationship.
 * C13 Observability: requestId/provider/model/latency/fallback tracked.
 * C14 Usage: token usage + cost estimate telemetry.
 * C15 Concurrent Requests: no cross-request state sharing.
 */
import { describe, expect, it } from "vitest";
import {
  asProposal,
  ProviderError,
  type LLMProposal,
  type LLMProvider,
  type LLMRequest,
} from "@yaoyao/application";
import {
  AIRouter,
  estimateUsage,
  MockLLMProvider,
  ResilientLLMInvoker,
} from "@yaoyao/runtime";
import { DeepSeekAdapter } from "@yaoyao/infrastructure";
import { OpenAIAdapter } from "@yaoyao/infrastructure";

function testRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    userId: "u" as never,
    yaoyaoId: "y" as never,
    systemContext: "system",
    conversationContext: "context",
    userInput: "hello",
    decision: { primaryIntent: "answer", conversationMode: "normal" },
    outputSchemaName: "llm-output-contract-v1",
    timeoutMs: 5000,
    metadata: { runtimeVersion: "test", contextVersion: "test", requestId: "req-1" },
    ...overrides,
  };
}

function validProposalJson(response = "hi there"): string {
  return JSON.stringify({
    response,
    emotion_signal: {},
    memory_candidates: [],
    relationship_signal: {},
    behavior: {},
  });
}

/** A controllable fake provider for router/resilience tests. */
function fakeProvider(
  providerId: string,
  behavior: (req: LLMRequest) => Promise<LLMProposal>,
): LLMProvider {
  return {
    providerId,
    modelId: `${providerId}-model`,
    capabilities: { supportsStructuredOutput: true, maxContextTokens: 8000, costTier: 1 },
    generate: behavior,
  };
}

describe("C02 — DeepSeek Adapter", () => {
  it("constructs with providerId deepseek and configured model", () => {
    const adapter = new DeepSeekAdapter({ apiKey: "test-key", modelId: "deepseek-chat" });
    expect(adapter.providerId).toBe("deepseek");
    expect(adapter.modelId).toBe("deepseek-chat");
    expect(adapter.capabilities.supportsStructuredOutput).toBe(true);
  });

  it("rejects missing API key at construction (fail-fast, no network)", () => {
    expect(() => new DeepSeekAdapter({ apiKey: "" })).toThrow(ProviderError);
  });

  it("parses a valid structured response into Proposals", () => {
    const adapter = new DeepSeekAdapter({ apiKey: "test-key" });
    const proposal = adapter.parseProposal(validProposalJson("你好"));
    expect(proposal.response.value).toBe("你好");
    expect(proposal.emotion_signal).toMatchObject({ __proposal: true });
  });

  it("maps invalid JSON to INVALID_RESPONSE (retryable)", () => {
    const adapter = new DeepSeekAdapter({ apiKey: "test-key" });
    try {
      adapter.parseProposal("not json at all");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("INVALID_RESPONSE");
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it("maps schema violations to INVALID_RESPONSE", () => {
    const adapter = new DeepSeekAdapter({ apiKey: "test-key" });
    try {
      adapter.parseProposal(JSON.stringify({ response: 123 }));
      expect.unreachable();
    } catch (err) {
      expect((err as ProviderError).code).toBe("INVALID_RESPONSE");
    }
  });
});

describe("C03 — OpenAI Adapter", () => {
  it("constructs with providerId openai", () => {
    const adapter = new OpenAIAdapter({ apiKey: "test-key" });
    expect(adapter.providerId).toBe("openai");
    expect(adapter.modelId).toBe("gpt-4o-mini");
  });

  it("rejects missing API key at construction", () => {
    expect(() => new OpenAIAdapter({ apiKey: "" })).toThrow(ProviderError);
  });

  it("parses a valid structured response", () => {
    const adapter = new OpenAIAdapter({ apiKey: "test-key" });
    const proposal = adapter.parseProposal(validProposalJson("hello"));
    expect(proposal.response.value).toBe("hello");
  });
});

describe("C04 — Provider Independence", () => {
  it("runtime source never imports a vendor SDK", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const srcDir = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts")) files.push(p);
      }
    };
    walk(srcDir);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from ["']openai["']/);
      expect(src).not.toMatch(/from ["']@anthropic/);
      expect(src).not.toMatch(/DeepSeekAdapter|OpenAIAdapter/);
    }
  });
});

describe("C05 — Router", () => {
  function router() {
    const l1 = fakeProvider("l1p", async () => { throw new Error("no"); });
    const l2 = fakeProvider("l2p", async () => { throw new Error("no"); });
    const l3 = fakeProvider("l3p", async () => { throw new Error("no"); });
    const fallback = fakeProvider("fb", async () => { throw new Error("no"); });
    return new AIRouter({ l1, l2, l3, fallback });
  }

  it("routes conversation → L2", () => {
    const selected = router().select({ task: "conversation", fallbackAllowed: true });
    expect(selected.tier).toBe("L2");
    expect(selected.provider.providerId).toBe("l2p");
  });

  it("routes structured → L1", () => {
    const selected = router().select({ task: "structured", fallbackAllowed: true });
    expect(selected.tier).toBe("L1");
  });

  it("routes premium → L3", () => {
    const selected = router().select({ task: "premium", fallbackAllowed: true });
    expect(selected.tier).toBe("L3");
  });

  it("honors preferredProvider override", () => {
    const selected = router().select({
      task: "conversation",
      preferredProvider: "l3p",
      fallbackAllowed: true,
    });
    expect(selected.provider.providerId).toBe("l3p");
  });
});

describe("C06 — Fallback", () => {
  it("primary failure → fallback provider produces the proposal", async () => {
    const primary = fakeProvider("primary", async () => {
      throw new ProviderError({
        code: "PROVIDER_5XX",
        providerId: "primary",
        message: "boom",
        retryable: true,
      });
    });
    const fallbackProposal: LLMProposal = {
      response: asProposal("fallback response"),
      emotion_signal: asProposal({}),
      memory_candidates: asProposal([]),
      relationship_signal: asProposal({}),
      behavior: asProposal({}),
    };
    const fallback = fakeProvider("fallback", async () => fallbackProposal);
    const invoker = new ResilientLLMInvoker(primary, fallback, { maxRetries: 0 });
    const { proposal, telemetry } = await invoker.invoke(testRequest());
    expect(proposal.response.value).toBe("fallback response");
    expect(telemetry.fallbackUsed).toBe(true);
    expect(telemetry.providerId).toBe("fallback");
  });
});

describe("C07 — Timeout causes no Core mutation", () => {
  it("a timed-out primary falls back; the error carries no persistence path", async () => {
    const primary = fakeProvider("primary", async () => {
      throw new ProviderError({
        code: "TIMEOUT",
        providerId: "primary",
        message: "timed out",
        retryable: true,
      });
    });
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(primary, fallback, { maxRetries: 0 });
    const { proposal, telemetry } = await invoker.invoke(testRequest());
    // Fallback produced a proposal; nothing was written anywhere
    // (the invoker holds no repository — structural, asserted by C10).
    expect(proposal.response.value).toContain("MVP-002C");
    expect(telemetry.fallbackUsed).toBe(true);
  });
});

describe("C08 — 429 retry with backoff", () => {
  it("retries once on RATE_LIMITED, then succeeds", async () => {
    let calls = 0;
    const primary = fakeProvider("primary", async () => {
      calls++;
      if (calls === 1) {
        throw new ProviderError({
          code: "RATE_LIMITED",
          providerId: "primary",
          message: "rate limited",
          retryable: true,
          retryAfterMs: 10,
        });
      }
      return {
        response: asProposal("recovered"),
        emotion_signal: asProposal({}),
        memory_candidates: asProposal([]),
        relationship_signal: asProposal({}),
        behavior: asProposal({}),
      };
    });
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(primary, fallback, { maxRetries: 1 });
    const { proposal, telemetry } = await invoker.invoke(testRequest());
    expect(calls).toBe(2);
    expect(proposal.response.value).toBe("recovered");
    expect(telemetry.retryCount).toBe(1);
    expect(telemetry.fallbackUsed).toBe(false);
  });
});

describe("C09 — Invalid output never reaches the user raw", () => {
  it("invalid JSON → retry → fallback proposal (validated shape)", async () => {
    const primary = fakeProvider("primary", async () => {
      throw new ProviderError({
        code: "INVALID_RESPONSE",
        providerId: "primary",
        message: "not JSON",
        retryable: true,
      });
    });
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(primary, fallback, { maxRetries: 1 });
    const { proposal } = await invoker.invoke(testRequest());
    // The fallback's proposal is a well-formed Proposal, not raw text.
    expect(proposal.response).toMatchObject({ __proposal: true });
    expect(typeof proposal.response.value).toBe("string");
  });
});

describe("C10 — I-016: provider output cannot trigger Core writes", () => {
  it("the invoker and adapters hold no persistence capability", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = [
      join(__dirname, "..", "src/router/resilient.ts"),
      join(__dirname, "..", "src/router/router.ts"),
    ];
    const infraLlm = join(__dirname, "..", "..", "infrastructure/src/llm");
    const { readdirSync } = await import("node:fs");
    for (const entry of readdirSync(infraLlm)) {
      if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        files.push(join(infraLlm, entry));
      }
    }
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/Repository/);
      expect(src, file).not.toMatch(/\.save\(/);
      expect(src, file).not.toMatch(/TransactionManager/);
    }
  });
});

describe("C11 — API Key Security", () => {
  it("ProviderError messages never contain the API key", () => {
    const secret = "sk-secret-12345";
    try {
      new DeepSeekAdapter({ apiKey: "" });
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
    const adapter = new DeepSeekAdapter({ apiKey: secret });
    try {
      adapter.parseProposal("garbage");
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it("telemetry contains no secrets", async () => {
    const primary = fakeProvider("primary", async () => {
      throw new ProviderError({
        code: "TIMEOUT", providerId: "primary", message: "t", retryable: false,
      });
    });
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(primary, fallback, { maxRetries: 0 });
    const { telemetry } = await invoker.invoke(testRequest());
    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toMatch(/sk-/);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("Authorization");
  });
});

describe("C12 — Provider Switch preserves identity", () => {
  it("DeepSeek → OpenAI: the runtime contract is identical", () => {
    const deepseek = new DeepSeekAdapter({ apiKey: "k1" });
    const openai = new OpenAIAdapter({ apiKey: "k2" });
    // Same port, same proposal shape — switching changes nothing upstream.
    const p1 = deepseek.parseProposal(validProposalJson("hi"));
    const p2 = openai.parseProposal(validProposalJson("hi"));
    expect(Object.keys(p1).sort()).toEqual(Object.keys(p2).sort());
    expect(p1.response.value).toBe(p2.response.value);
  });
});

describe("C13 — Observability", () => {
  it("telemetry records requestId/provider/model/latency/retry/fallback", async () => {
    const primary = new MockLLMProvider();
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(primary, fallback);
    const { telemetry } = await invoker.invoke(testRequest({ metadata: { runtimeVersion: "t", contextVersion: "t", requestId: "req-abc" } }));
    expect(telemetry.requestId).toBe("req-abc");
    expect(telemetry.providerId).toBe("mock");
    expect(telemetry.modelId).toBe("mock-echo-002A");
    expect(telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(telemetry.retryCount).toBe(0);
    expect(telemetry.fallbackUsed).toBe(false);
  });
});

describe("C14 — Usage telemetry", () => {
  it("estimates cost from token usage", () => {
    const usage = estimateUsage({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 1200,
    });
    expect(usage.inputTokens).toBe(1000);
    expect(usage.outputTokens).toBe(500);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
    // Unknown model → zero estimate (no crash, no NaN).
    const unknown = estimateUsage({
      providerId: "x", modelId: "y", inputTokens: 100, outputTokens: 100, latencyMs: 10,
    });
    expect(unknown.estimatedCostUsd).toBe(0);
  });
});

describe("C15 — Concurrent requests share no state", () => {
  it("parallel invocations get independent results", async () => {
    const provider = fakeProvider("p", async (req) => ({
      response: asProposal(`echo:${req.metadata.requestId}`),
      emotion_signal: asProposal({}),
      memory_candidates: asProposal([]),
      relationship_signal: asProposal({}),
      behavior: asProposal({}),
    }));
    const fallback = new MockLLMProvider();
    const invoker = new ResilientLLMInvoker(provider, fallback);
    const results = await Promise.all(
      ["r1", "r2", "r3"].map((id) =>
        invoker.invoke(testRequest({ metadata: { runtimeVersion: "t", contextVersion: "t", requestId: id } })),
      ),
    );
    const responses = results.map((r) => r.proposal.response.value);
    expect(responses).toEqual(["echo:r1", "echo:r2", "echo:r3"]);
    const requestIds = results.map((r) => r.telemetry.requestId);
    expect(requestIds).toEqual(["r1", "r2", "r3"]);
  });
});
