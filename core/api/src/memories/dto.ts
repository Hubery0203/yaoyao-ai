import { z } from "zod";
import { MEMORY_STATUSES, MEMORY_TYPES } from "@yaoyao/domain";

export const MemoriesQuerySchema = z.object({
  type: z.enum(MEMORY_TYPES).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type MemoriesQueryDto = z.infer<typeof MemoriesQuerySchema>;
