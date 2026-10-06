/**
 * @yaoyao/http — HTTP surface layer.
 *
 * Controllers translate transport shapes (DTOs) and invoke application use
 * cases. Guards enforce authentication; the error envelope is standardized
 * here. This layer never touches infrastructure directly — persistence
 * wiring happens in apps/* hosts.
 *
 * Phase 1: health endpoints only (liveness/readiness contract).
 * Versioned API surface (/api/v1/...) lands with real endpoints in Phase 4.
 */
export { HealthController } from "./health/health.controller.js";
export { HealthModule } from "./health/health.module.js";
