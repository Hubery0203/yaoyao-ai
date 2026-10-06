import { DomainValidationError } from "../shared/errors.js";
import {
  assertNonEmptyString,
  assertUnitInterval,
  assertValidDate,
} from "../shared/guards.js";
import {
  newMemoryId,
  type EventId,
  type MemoryContainerId,
  type MemoryId,
  type UserId,
  type YaoYaoId,
} from "../shared/ids.js";

/** Reserved memory types (Data Model §5). */
export const MEMORY_TYPES = ["CORE", "SEMANTIC", "EPISODIC", "SHARED_LIFE"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * Memory lifecycle (Data Model §10):
 * CANDIDATE → VALIDATED → CONSOLIDATED → (CORRECTED supersedes) → ARCHIVED.
 * Recall is tracked via counters, not a status — recalling never mutates
 * the memory's standing.
 */
export const MEMORY_STATUSES = [
  "CANDIDATE",
  "VALIDATED",
  "CONSOLIDATED",
  "CORRECTED",
  "ARCHIVED",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/**
 * Memory — what is worth retaining. NOT chat history.
 *
 * A memory is born as a CANDIDATE and only becomes long-term through
 * validation and consolidation. Corrections never rewrite history: the old
 * version is kept with status CORRECTED and the new version links back via
 * supersedes. Conflicting memories preserve temporal/source information
 * instead of blindly overwriting.
 */
export class Memory {
  private constructor(
    readonly memoryId: MemoryId,
    readonly containerId: MemoryContainerId,
    readonly userId: UserId,
    readonly yaoyaoId: YaoYaoId,
    readonly type: MemoryType,
    readonly content: string,
    readonly importance: number,
    readonly confidence: number,
    readonly sourceEvents: ReadonlyArray<EventId>,
    readonly status: MemoryStatus,
    readonly version: number,
    readonly supersedes: MemoryId | null,
    readonly archiveReason: string | null,
    readonly createdAt: Date,
    readonly updatedAt: Date,
    readonly lastRecalledAt: Date | null,
    readonly timesRecalled: number,
  ) {
    Object.freeze(this);
  }

  static candidate(input: {
    containerId: MemoryContainerId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    type: MemoryType;
    content: string;
    importance?: number;
    confidence?: number;
    sourceEvents?: EventId[];
    memoryId?: MemoryId;
  }): Memory {
    if (!MEMORY_TYPES.includes(input.type)) {
      throw new DomainValidationError(`unknown memory type: ${input.type}`);
    }
    assertNonEmptyString(input.content, "content");
    const importance = input.importance ?? 0.5;
    const confidence = input.confidence ?? 0.5;
    assertUnitInterval(importance, "importance");
    assertUnitInterval(confidence, "confidence");
    const now = new Date();
    return new Memory(
      input.memoryId ?? newMemoryId(),
      input.containerId,
      input.userId,
      input.yaoyaoId,
      input.type,
      input.content,
      importance,
      confidence,
      Object.freeze([...(input.sourceEvents ?? [])]),
      "CANDIDATE",
      1,
      null,
      null,
      now,
      now,
      null,
      0,
    );
  }

  /** Rebuild from persistence (Phase 3). */
  static reconstitute(input: {
    memoryId: MemoryId;
    containerId: MemoryContainerId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    type: MemoryType;
    content: string;
    importance: number;
    confidence: number;
    sourceEvents: EventId[];
    status: MemoryStatus;
    version: number;
    supersedes: MemoryId | null;
    archiveReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastRecalledAt: Date | null;
    timesRecalled: number;
  }): Memory {
    if (!MEMORY_TYPES.includes(input.type)) {
      throw new DomainValidationError(`unknown memory type: ${input.type}`);
    }
    if (!MEMORY_STATUSES.includes(input.status)) {
      throw new DomainValidationError(`unknown memory status: ${input.status}`);
    }
    assertNonEmptyString(input.content, "content");
    assertUnitInterval(input.importance, "importance");
    assertUnitInterval(input.confidence, "confidence");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new DomainValidationError(`version must be >= 1, got ${input.version}`);
    }
    if (!Number.isInteger(input.timesRecalled) || input.timesRecalled < 0) {
      throw new DomainValidationError("timesRecalled must be >= 0");
    }
    assertValidDate(input.createdAt, "createdAt");
    assertValidDate(input.updatedAt, "updatedAt");
    return new Memory(
      input.memoryId,
      input.containerId,
      input.userId,
      input.yaoyaoId,
      input.type,
      input.content,
      input.importance,
      input.confidence,
      Object.freeze([...input.sourceEvents]),
      input.status,
      input.version,
      input.supersedes,
      input.archiveReason,
      input.createdAt,
      input.updatedAt,
      input.lastRecalledAt,
      input.timesRecalled,
    );
  }

  private transition(
    status: MemoryStatus,
    mutate: (m: Memory) => Partial<Memory>,
  ): Memory {
    const patch = mutate(this);
    return new Memory(
      this.memoryId,
      this.containerId,
      this.userId,
      this.yaoyaoId,
      this.type,
      patch.content ?? this.content,
      patch.importance ?? this.importance,
      patch.confidence ?? this.confidence,
      this.sourceEvents,
      status,
      patch.version ?? this.version,
      patch.supersedes ?? this.supersedes,
      patch.archiveReason ?? this.archiveReason,
      this.createdAt,
      new Date(),
      patch.lastRecalledAt ?? this.lastRecalledAt,
      patch.timesRecalled ?? this.timesRecalled,
    );
  }

  private requireStatus(expected: MemoryStatus, action: string): void {
    if (this.status !== expected) {
      throw new DomainValidationError(
        `cannot ${action} a memory with status ${this.status} (expected ${expected})`,
      );
    }
  }

  /** CANDIDATE → VALIDATED */
  validate(): Memory {
    this.requireStatus("CANDIDATE", "validate");
    return this.transition("VALIDATED", () => ({}));
  }

  /** VALIDATED → CONSOLIDATED (becomes long-term). */
  consolidate(): Memory {
    this.requireStatus("VALIDATED", "consolidate");
    return this.transition("CONSOLIDATED", () => ({}));
  }

  /**
   * Record a recall. Counters move; status never does — recalling a memory
   * must not change its standing.
   */
  recordRecall(): Memory {
    if (this.status === "ARCHIVED") {
      throw new DomainValidationError("cannot recall an archived memory");
    }
    return this.transition(this.status, (m) => ({
      lastRecalledAt: new Date(),
      timesRecalled: m.timesRecalled + 1,
    }));
  }

  /**
   * Correct a memory. History is preserved: the old version is kept with
   * status CORRECTED, and the new version (version+1) links back via
   * supersedes. A MEMORY_CORRECTED domain event should accompany this
   * (emitted by the application layer in Phase 5+).
   */
  correct(input: {
    content: string;
    importance?: number;
    confidence?: number;
    sourceEvents?: EventId[];
  }): { superseded: Memory; current: Memory } {
    if (this.status === "ARCHIVED" || this.status === "CORRECTED") {
      throw new DomainValidationError(
        `cannot correct a memory with status ${this.status}`,
      );
    }
    assertNonEmptyString(input.content, "content");
    const importance = input.importance ?? this.importance;
    const confidence = input.confidence ?? this.confidence;
    assertUnitInterval(importance, "importance");
    assertUnitInterval(confidence, "confidence");
    const superseded = this.transition("CORRECTED", () => ({}));
    const current = new Memory(
      newMemoryId(),
      this.containerId,
      this.userId,
      this.yaoyaoId,
      this.type,
      input.content,
      importance,
      confidence,
      Object.freeze([...(input.sourceEvents ?? this.sourceEvents)]),
      "CONSOLIDATED",
      this.version + 1,
      this.memoryId,
      null,
      this.createdAt,
      new Date(),
      null,
      0,
    );
    return { superseded, current };
  }

  /** Retire a memory with a reason. Archived memories are never recalled. */
  archive(reason: string): Memory {
    assertNonEmptyString(reason, "archiveReason");
    if (this.status === "ARCHIVED") {
      throw new DomainValidationError("memory is already archived");
    }
    return this.transition("ARCHIVED", () => ({ archiveReason: reason }));
  }
}
