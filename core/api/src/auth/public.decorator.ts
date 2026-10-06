import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route (or controller) as public — exempt from the global
 * JwtAuthGuard. Default is deny: every route requires a valid JWT unless
 * explicitly marked @Public(). Public surface is intentionally tiny:
 * health, login, refresh, registration.
 */
export const IS_PUBLIC_KEY = "yaoyao:isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
