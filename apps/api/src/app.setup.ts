import { type INestApplication, RequestMethod } from "@nestjs/common";

/**
 * Shared host configuration for apps/api.
 *
 * Used by both the production bootstrap (main.ts) and e2e tests so the
 * versioning contract cannot drift between the two.
 *
 * Contract: all public endpoints live under /api/v1; operational health
 * endpoints stay unversioned (Technical Proposal §08).
 */
export function applyAppDefaults(app: INestApplication): void {
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
}
