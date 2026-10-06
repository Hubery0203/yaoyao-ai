import { Controller, Get, Inject, Optional } from "@nestjs/common";
import {
  HEALTH_PROBE,
  type HealthProbe,
} from "@yaoyao/application";
import { Public } from "../auth/public.decorator.js";

interface HealthCheck {
  name: string;
  status: "ok" | "degraded" | "not_configured";
  detail?: string;
}

/**
 * Operational health endpoints (Technical Proposal §14).
 *
 * Liveness vs readiness are separate: readiness reports dependency state
 * without exposing private data. The database probe is injected by the
 * host when wired (Phase 4); without it the check honestly reports
 * "not_configured".
 */
@Controller("health")
@Public()
export class HealthController {
  constructor(
    @Optional() @Inject(HEALTH_PROBE) private readonly probe?: HealthProbe,
  ) {}

  @Get("live")
  live(): { status: "ok"; service: string } {
    return { status: "ok", service: "yaoyao-ai" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ok"; checks: HealthCheck[] }> {
    const checks: HealthCheck[] = [
      { name: "config", status: "ok" },
      this.probe
        ? { name: "database", status: await this.probe.checkDatabase() }
        : {
            name: "database",
            status: "not_configured",
            detail: "No database probe wired.",
          },
      {
        name: "redis",
        status: process.env.REDIS_URL ? "ok" : "not_configured",
        detail: process.env.REDIS_URL
          ? undefined
          : "Coordination-only; not required for MVP-001.",
      },
    ];
    return { status: "ok", checks };
  }
}
