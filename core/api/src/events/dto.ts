import { z } from "zod";

export const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type EventsQueryDto = z.infer<typeof EventsQuerySchema>;
