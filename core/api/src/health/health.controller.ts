import { Controller, Get } from "@nestjs/common";

interface HealthCheck {
  name: string;
  status: "ok" | "degraded" | "not_configured";
  detail?: string;
}

/**
 * Operational health endpoints (Technical Proposal §14).
 *
 * Liveness vs readiness are separate: readiness reports dependency state
 * without exposing private data. Database/Redis checks report
 * "not_configured" until their phases land (Phase 3 / coordination).
 */
@Controller("health")
export class HealthController {
  @Get("live")
  live(): { status: "ok"; service: string } {
    return { status: "ok", service: "yaoyao-ai" };
  }

  @Get("ready")
  ready(): { status: "ok"; checks: HealthCheck[] } {
    const checks: HealthCheck[] = [
      { name: "config", status: "ok" },
      {
        name: "database",
        status: "not_configured",
        detail: "PostgreSQL wiring lands in Phase 3 (Persistence).",
      },
      {
        name: "redis",
        status: process.env.REDIS_URL ? "ok" : "not_configured",
        detail: process.env.REDIS_URL
          ? undefined
          : "Coordination-only; not required for Phase 1.",
      },
    ];
    return { status: "ok", checks };
  }
}
