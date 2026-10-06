/**
 * @yaoyao/domain — YaoYao Core domain layer.
 *
 * HARD RULE (Technical Proposal §03, enforced by dependency-cruiser):
 * this package may import from the TypeScript/Node standard library ONLY.
 * No @nestjs/*, no drizzle-orm, no pg, no ioredis, no bullmq, no @yaoyao/*.
 *
 * Phase 1: scaffolding only — aggregates (User, YaoYaoAggregate, Relationship,
 * CoreState, Session, EventLog, Memory) land in Phase 2 (Domain).
 */
export {};
