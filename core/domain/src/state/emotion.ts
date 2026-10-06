import { assertAllUnitInterval } from "../shared/guards.js";

/** MVP emotion dimensions (Data Model §3). Each in [0, 1]. */
export const EMOTION_DIMENSIONS = [
  "happiness",
  "sadness",
  "anger",
  "hurt",
  "affection",
  "jealousy",
  "loneliness",
  "excitement",
  "calm",
] as const;

export type EmotionDimension = (typeof EMOTION_DIMENSIONS)[number];
export type EmotionValues = Record<EmotionDimension, number>;

/**
 * Seed emotion for a newly initialized YaoYao.
 * Tunable in MVP-005 (production emotion algorithm); the shape is frozen now.
 */
export const INITIAL_EMOTION: EmotionValues = Object.freeze({
  happiness: 0.6,
  sadness: 0.05,
  anger: 0,
  hurt: 0,
  affection: 0.7,
  jealousy: 0,
  loneliness: 0.1,
  excitement: 0.4,
  calm: 0.6,
});

/**
 * EmotionVector — immutable value object.
 *
 * Emotion is State, not Persona (Constitution §5). It may change freely
 * within [0, 1], but no emotion value can ever change the relationship
 * type — that separation is enforced structurally (see Relationship).
 */
export class EmotionVector {
  private constructor(readonly values: Readonly<EmotionValues>) {}

  static create(values: EmotionValues): EmotionVector {
    assertAllUnitInterval({ ...values }, "emotion");
    for (const dim of EMOTION_DIMENSIONS) {
      if (!(dim in values)) {
        throw new Error(`emotion vector missing dimension: ${dim}`);
      }
    }
    return new EmotionVector(Object.freeze({ ...values }));
  }

  static initial(): EmotionVector {
    return new EmotionVector(INITIAL_EMOTION);
  }

  get(dimension: EmotionDimension): number {
    return this.values[dimension];
  }

  /** Return a new vector with the given dimensions replaced (validated). */
  with(patch: Partial<EmotionValues>): EmotionVector {
    return EmotionVector.create({ ...this.values, ...patch });
  }
}
