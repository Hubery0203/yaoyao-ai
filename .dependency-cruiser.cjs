/**
 * Architecture boundary enforcement — YaoYao AI MVP-001.
 *
 * Required dependency direction (Technical Proposal §03):
 *
 *   apps/*  →  @yaoyao/http, @yaoyao/application, @yaoyao/infrastructure
 *   @yaoyao/http        →  @yaoyao/application            (never infrastructure, never apps)
 *   @yaoyao/application →  @yaoyao/domain                (never infrastructure/http/apps)
 *   @yaoyao/infrastructure → @yaoyao/domain, @yaoyao/application ports
 *   @yaoyao/domain      →  standard library ONLY
 *
 * Rationale: business rules live in aggregates/value objects/policies inside
 * @yaoyao/domain. Controllers, database schemas, and prompts may mirror
 * constraints for usability or defense, but cannot define them.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-is-framework-free",
      comment:
        "Domain layer: standard library only. No NestJS, Drizzle, pg, Redis, BullMQ, or any node_modules import.",
      severity: "error",
      from: { path: "core/domain/src" },
      to: { path: "node_modules" },
    },
    {
      name: "no-domain-to-outer-layers",
      comment: "Domain must not depend on application, infrastructure, http, or apps.",
      severity: "error",
      from: { path: "core/domain/src" },
      to: { path: "core/(application|infrastructure|api)|apps/" },
    },
    {
      name: "application-depends-on-domain-only",
      comment: "Application orchestrates domain via ports; it must not reach infrastructure, http, or apps.",
      severity: "error",
      from: { path: "core/application/src" },
      to: { path: "core/(infrastructure|api)|apps/" },
    },
    {
      name: "http-never-touches-infrastructure",
      comment: "HTTP surface translates transport shapes and invokes application use cases; persistence wiring lives in apps/*.",
      severity: "error",
      from: { path: "core/api/src" },
      to: { path: "core/infrastructure|apps/" },
    },
    {
      name: "no-cross-app-imports",
      comment: "api and worker are independent hosts; they share code via core/* only.",
      severity: "error",
      from: { path: "apps/api" },
      to: { path: "apps/worker" },
    },
    {
      name: "no-cross-app-imports-reverse",
      comment: "api and worker are independent hosts; they share code via core/* only.",
      severity: "error",
      from: { path: "apps/worker" },
      to: { path: "apps/api" },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies anywhere — they collapse layer boundaries.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "./tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      archi: { collapsePattern: "^(apps|core)/[^/]+" },
    },
  },
};
