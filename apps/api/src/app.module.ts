import { Module } from "@nestjs/common";
import { HealthModule } from "@yaoyao/http";

/**
 * API host module — composition only.
 *
 * Real endpoint modules (auth, users, sessions, events, memories) land in
 * Phase 4. Business rules live in @yaoyao/domain; orchestration in
 * @yaoyao/application; this host only wires them together.
 */
@Module({ imports: [HealthModule] })
export class AppModule {}
