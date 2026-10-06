import { type INestApplication, RequestMethod } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json } from "express";
import helmet from "helmet";

/**
 * Shared host configuration for apps/api.
 *
 * Used by both the production bootstrap (main.ts) and e2e tests so the
 * versioning contract cannot drift between the two.
 *
 * Contract: all public endpoints live under /api/v1; operational health
 * endpoints stay unversioned (Technical Proposal §08).
 *
 * Transport hardening (Phase 4 proposal §I):
 * - helmet security headers (HSTS, no-sniff, frame-deny)
 * - 100 KB JSON body cap (no binary uploads in MVP-001)
 * - CORS disabled by default (no browser client yet)
 */
export function applyAppDefaults(app: INestApplication): void {
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  app.use(helmet());
  app.use(json({ limit: "100kb" }));
  app.enableShutdownHooks();
}

/** Build the OpenAPI document for the versioned API surface. */
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("YaoYao AI — MVP-001 Core API")
    .setDescription(
      "Versioned HTTP surface for the YaoYao Core: authentication, identity, state, sessions, events, memories, and read-only diagnostics.",
    )
    .setVersion("0.1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "access-token",
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Serve Swagger UI (non-production convenience; mount path is fixed). */
export function setupSwaggerUi(app: INestApplication): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup("api-docs", app, document);
}
