/**
 * Structured output contract — MVP-002C.
 *
 * The JSON schema for the frozen LLM Output Contract (§10), shared by all
 * provider adapters. Adapters instruct the model to return this shape and
 * validate the raw response against the zod schema before wrapping fields
 * as Proposal<T>.
 *
 * Schema validation is the FIRST gate: malformed output never reaches the
 * runtime's validation pipeline. A schema failure is a ProviderError
 * (INVALID_RESPONSE, retryable) — the resilient wrapper may retry once,
 * then fall back.
 */
import { z } from "zod";

export const LLMOutputSchema = z.object({
  response: z.string().min(1).max(8000),
  emotion_signal: z
    .object({
      dimensions: z.record(z.string(), z.number().min(0).max(1)).optional(),
      intensity: z.number().min(0).max(1).optional(),
    })
    .default({}),
  memory_candidates: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        importance: z.number().min(0).max(1).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .max(10)
    .default([]),
  relationship_signal: z.object({ note: z.string().max(500).optional() }).default({}),
  behavior: z.object({ tone: z.string().max(100).optional() }).default({}),
});

export type LLMOutputShape = z.infer<typeof LLMOutputSchema>;

/**
 * JSON Schema (for providers that support json_schema response format).
 * Kept in sync with LLMOutputSchema by construction — both describe the
 * same 5-field contract.
 */
export const LLM_OUTPUT_JSON_SCHEMA = {
  name: "yaoyao_llm_proposal",
  strict: true,
  schema: {
    type: "object",
    properties: {
      response: { type: "string", minLength: 1, maxLength: 8000 },
      emotion_signal: {
        type: "object",
        properties: {
          dimensions: {
            type: "object",
            additionalProperties: { type: "number", minimum: 0, maximum: 1 },
          },
          intensity: { type: "number", minimum: 0, maximum: 1 },
        },
        additionalProperties: false,
      },
      memory_candidates: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 2000 },
            importance: { type: "number", minimum: 0, maximum: 1 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
      relationship_signal: {
        type: "object",
        properties: { note: { type: "string", maxLength: 500 } },
        additionalProperties: false,
      },
      behavior: {
        type: "object",
        properties: { tone: { type: "string", maxLength: 100 } },
        additionalProperties: false,
      },
    },
    required: [
      "response",
      "emotion_signal",
      "memory_candidates",
      "relationship_signal",
      "behavior",
    ],
    additionalProperties: false,
  },
} as const;

/** System-prompt instruction describing the required output shape. */
export const STRUCTURED_OUTPUT_INSTRUCTION = [
  "You MUST respond with a single JSON object matching this exact shape:",
  '{"response": "<your reply text>", "emotion_signal": {}, "memory_candidates": [], "relationship_signal": {}, "behavior": {}}',
  "- response: your reply to the user (required, non-empty).",
  "- emotion_signal: optional proposed emotion dimensions (0-1) and intensity.",
  "- memory_candidates: optional array of {text, importance?, confidence?} worth remembering.",
  "- relationship_signal: optional {note}. You MUST NOT propose relationship type/status changes.",
  "- behavior: optional {tone}.",
  "Return ONLY the JSON object. No markdown fences, no preamble.",
].join("\n");
