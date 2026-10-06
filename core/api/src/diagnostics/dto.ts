import { z } from "zod";

export const ReplayQuerySchema = z.object({
  from_seq: z.coerce.number().int().min(0).optional(),
});
export type ReplayQueryDto = z.infer<typeof ReplayQuerySchema>;
