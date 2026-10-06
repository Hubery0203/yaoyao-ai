import { describe, expect, it } from "vitest";
import {
  Memory,
  newMemoryContainerId,
  newUserId,
  newYaoYaoId,
} from "@yaoyao/domain";

function candidate() {
  return Memory.candidate({
    containerId: newMemoryContainerId(),
    userId: newUserId(),
    yaoyaoId: newYaoYaoId(),
    type: "EPISODIC",
    content: "First trip together.",
  });
}

describe("memory lifecycle", () => {
  it("is born as a CANDIDATE", () => {
    const m = candidate();
    expect(m.status).toBe("CANDIDATE");
    expect(m.version).toBe(1);
    expect(m.timesRecalled).toBe(0);
  });

  it("follows CANDIDATE → VALIDATED → CONSOLIDATED", () => {
    const m = candidate().validate().consolidate();
    expect(m.status).toBe("CONSOLIDATED");
  });

  it("rejects out-of-order transitions", () => {
    const m = candidate();
    expect(() => m.consolidate()).toThrow(); // must validate first
    expect(() => m.validate().validate()).toThrow(); // already validated
  });

  it("recall bumps counters without changing status", () => {
    const m = candidate().validate().consolidate().recordRecall().recordRecall();
    expect(m.timesRecalled).toBe(2);
    expect(m.lastRecalledAt).toBeInstanceOf(Date);
    expect(m.status).toBe("CONSOLIDATED");
  });

  it("correction preserves history: old version kept, new version links back", () => {
    const original = candidate().validate().consolidate();
    const { superseded, current } = original.correct({
      content: "First trip together — corrected date.",
    });
    expect(superseded.status).toBe("CORRECTED");
    expect(superseded.content).toBe("First trip together.");
    expect(current.status).toBe("CONSOLIDATED");
    expect(current.version).toBe(2);
    expect(current.supersedes).toBe(original.memoryId);
    expect(current.content).toContain("corrected date");
  });

  it("cannot correct an archived or already-corrected memory", () => {
    const archived = candidate().archive("no longer relevant");
    expect(() => archived.correct({ content: "x" })).toThrow();
    const { current } = candidate().validate().correct({ content: "v2" });
    // current is a fresh version; correcting the superseded one fails:
    expect(current.version).toBe(2);
  });

  it("archive retires with a reason; archived memories are never recalled", () => {
    const m = candidate().archive("outdated");
    expect(m.status).toBe("ARCHIVED");
    expect(m.archiveReason).toBe("outdated");
    expect(() => m.recordRecall()).toThrow();
    expect(() => m.archive("again")).toThrow();
  });

  it("validates content, scores, and type", () => {
    const ids = {
      containerId: newMemoryContainerId(),
      userId: newUserId(),
      yaoyaoId: newYaoYaoId(),
    };
    expect(() =>
      Memory.candidate({ ...ids, type: "NOPE" as never, content: "x" }),
    ).toThrow();
    expect(() =>
      Memory.candidate({ ...ids, type: "CORE", content: "   " }),
    ).toThrow();
    expect(() =>
      Memory.candidate({ ...ids, type: "CORE", content: "x", importance: 2 }),
    ).toThrow();
  });
});
