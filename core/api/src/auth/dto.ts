import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  deviceMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
