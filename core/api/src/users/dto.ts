import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(8).max(256),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const UserIdParamSchema = z.object({
  user_id: z.string().min(1).max(64),
});
