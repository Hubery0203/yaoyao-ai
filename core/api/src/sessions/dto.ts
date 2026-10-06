import { z } from "zod";

export const StartSessionSchema = z.object({
  clientInstanceId: z.string().max(128).nullable().optional(),
});
export type StartSessionDto = z.infer<typeof StartSessionSchema>;

export const SessionIdParamSchema = z.object({
  session_id: z.string().min(1).max(64),
});
