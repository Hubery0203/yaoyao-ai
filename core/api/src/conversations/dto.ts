import { z } from "zod";

/**
 * POST /api/v1/conversations/messages request body (MVP-002A).
 *
 * Minimal: the user's text. Session binding, idempotency-key, and richer
 * options arrive in later phases. The text limit guards against abuse;
 * full conversation history is server-side (C6 in 002B+).
 */
export const SendMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});
export type SendMessageDto = z.infer<typeof SendMessageSchema>;
