/**
 * Emotion proposal schema — MVP-002E.
 *
 * Structured output contract for the EmotionInterpreter's dedicated
 * interpretation call. The schema name constant lives on the application
 * port (@yaoyao/application EMOTION_PROPOSAL_SCHEMA_NAME); the
 * infrastructure adapter dispatches on it.
 * The adapter validates the raw model output against this zod schema
 * before the runtime's validation pipeline sees it.
 *
 * ALL fields are proposals (deltas, not state). The domain transition
 * remains the final authority.
 */
import { z } from "zod";
import { EMOTION_DIMENSIONS } from "@yaoyao/domain";

const emotionDimension = z.enum(
  EMOTION_DIMENSIONS as unknown as [string, ...string[]],
);

export const EmotionProposalSchema = z.object({
  primary: emotionDimension,
  secondary: z.array(emotionDimension).max(8).default([]),
  intensity: z.number().min(0).max(1),
  signals: z
    .record(z.string(), z.number().min(-1).max(1))
    .default({}),
  confidence: z.number().min(0).max(1),
  cause: z.string().max(100).optional(),
});

export type EmotionProposalShape = z.infer<typeof EmotionProposalSchema>;

/** Schema name used in LLMRequest.outputSchemaName for interpreter calls. */
export const EMOTION_PROPOSAL_SCHEMA_NAME = "emotion-proposal-v1";