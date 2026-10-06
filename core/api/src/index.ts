/**
 * @yaoyao/http — HTTP surface layer.
 *
 * Controllers translate transport shapes (DTOs) and invoke application use
 * cases. Guards enforce authentication; the error envelope is standardized
 * here. This layer never touches infrastructure directly — persistence
 * wiring happens in apps/* hosts.
 */
export { HealthController } from "./health/health.controller.js";
export { HealthModule } from "./health/health.module.js";
export { ApiModule } from "./api.module.js";
export { JwtAuthGuard, requirePrincipal } from "./auth/jwt-auth.guard.js";
export type { RequestPrincipal } from "./auth/jwt-auth.guard.js";
export { Public, IS_PUBLIC_KEY } from "./auth/public.decorator.js";
export { DomainExceptionFilter } from "./common/http-exception.filter.js";
export { ZodValidationPipe } from "./common/zod-validation.pipe.js";
export * from "./common/projections.js";
