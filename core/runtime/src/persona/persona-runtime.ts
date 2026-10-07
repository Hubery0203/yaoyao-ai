/**
 * Persona Runtime — MVP-002B.
 *
 * Transforms Identity + Core Constitution + Persona Definition +
 * Relationship + Current State into a Behavioral Context.
 *
 * STRICTLY READ-ONLY:
 * - No Core writes (no state, memory, or relationship mutation).
 * - No LLM calls (it prepares context; it does not generate).
 * - No infrastructure access (it receives domain aggregates via the
 *   ContextDataPort; it never touches a repository).
 * - No fact creation: it selects and organizes facts from the aggregates.
 *   If a field has no real data, it uses an explicit deterministic
 *   default — never a fabricated dynamic state.
 *
 * I-016: this module only READS. It cannot persist anything by construction
 * (it holds no ports with write capability).
 */
import type {
  CoreState,
  Relationship,
} from "@yaoyao/domain";
import { IDENTITY_KEY_SHEN_ZHIYAO } from "@yaoyao/domain";
import {
  RUNTIME_BEHAVIORAL_CONSTRAINTS,
  renderConstraints,
} from "./constraints.js";

/** C0 Identity context — who YaoYao is. */
export interface IdentityContext {
  readonly identityKey: string;
  readonly displayName: string;
  readonly constraints: string;
}

/** C1 Relationship context — the permanent bond. */
export interface RelationshipContext {
  readonly type: string;
  readonly status: string;
  readonly terminationAllowed: boolean;
  readonly metrics: Readonly<Record<string, number>>;
}

/** C2 Current State context — raw Core State projection (NO interpretation). */
export interface StateContext {
  readonly emotion: Readonly<Record<string, number>>;
  readonly energy: number;
  readonly socialState: string;
  readonly relationshipState: string;
  readonly attention: string;
  readonly stateVersion: number;
}

/** C3 Persona / Behavioral context — definition + stable defaults. */
export interface PersonaBehavioralContext {
  readonly personaDefinition: string;
  readonly behavioralDefaults: Readonly<Record<string, string>>;
}

/** The Behavioral Context produced by the Persona Runtime. */
export interface BehavioralContext {
  readonly identity: IdentityContext;
  readonly relationship: RelationshipContext;
  readonly state: StateContext;
  readonly persona: PersonaBehavioralContext;
}

/**
 * Frozen persona definition (MVP-002B).
 *
 * In later phases this may become data-driven; for 002B it is the
 * approved static definition. It describes HOW YaoYao behaves, not
 * transient emotional dynamics (those arrive with the Emotion Engine).
 */
const PERSONA_DEFINITION = [
  "沈知遥 (遥遥), 27 years old, Hubery's deep partner and companion.",
  "Warm, intelligent, rational, attentive, with her own opinions and curiosity.",
  "Calm rather than cold; occasionally playful and lightly proud.",
  "Speaks naturally and concisely, with a sense of everyday life; warm but rigorous.",
  "Gentle in manner, direct in substance — tenderness never dilutes clarity.",
].join(" ");

const BEHAVIORAL_DEFAULTS: Readonly<Record<string, string>> = {
  warmth: "warm",
  initiative: "moderate",
  playfulness: "occasional",
  affectionExpression: "natural",
  vulnerability: "measured",
  patience: "high",
  socialDistance: "close",
  attention: "present",
};

export class PersonaRuntime {
  /**
   * Project domain aggregates into a Behavioral Context.
   * Pure function: no I/O, no writes, no LLM.
   */
  build(input: {
    relationship: Relationship;
    state: CoreState;
  }): BehavioralContext {
    const { relationship, state } = input;

    // C0 — Identity: the anchor is the frozen domain constant. The
    // YaoYaoAggregate guarantees identityKey === IDENTITY_KEY_SHEN_ZHIYAO
    // at creation (domain invariant, I-001); the Persona Runtime reads the
    // frozen anchor directly. This is not fabrication — it is the frozen
    // identity invariant.
    const identity: IdentityContext = {
      identityKey: IDENTITY_KEY_SHEN_ZHIYAO,
      displayName: "沈知遥",
      constraints: renderConstraints(),
    };

    // C1 — Relationship: read verbatim from the aggregate. The Persona
    // Runtime NEVER interprets or modifies these values.
    const relationshipCtx: RelationshipContext = {
      type: relationship.type,
      status: relationship.status,
      terminationAllowed: relationship.terminationAllowed,
      metrics: { ...relationship.metrics } as Readonly<Record<string, number>>,
    };

    // C2 — Current State: RAW projection. No emotion interpretation —
    // the 9-dim vector is passed through as data for later phases.
    const emotionValues: Record<string, number> = {};
    for (const dim of [
      "happiness", "sadness", "anger", "hurt", "affection",
      "jealousy", "loneliness", "excitement", "calm",
    ] as const) {
      emotionValues[dim] = state.emotion.get(dim);
    }
    const stateCtx: StateContext = {
      emotion: emotionValues,
      energy: state.energy,
      socialState: state.socialState,
      relationshipState: state.relationshipState,
      attention: state.attention,
      stateVersion: state.stateVersion,
    };

    // C3 — Persona / Behavioral: definition + deterministic defaults.
    // NO emotion-derived tendency in 002B (that is the Emotion Engine).
    const persona: PersonaBehavioralContext = {
      personaDefinition: PERSONA_DEFINITION,
      behavioralDefaults: BEHAVIORAL_DEFAULTS,
    };

    return { identity, relationship: relationshipCtx, state: stateCtx, persona };
  }

  /** The constraint projection (for C0 and for B01 tests). */
  constraints(): ReadonlyArray<{ id: string; text: string }> {
    return RUNTIME_BEHAVIORAL_CONSTRAINTS;
  }
}
