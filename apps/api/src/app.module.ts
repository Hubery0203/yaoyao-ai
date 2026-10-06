import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  ApiModule,
  DomainExceptionFilter,
  JwtAuthGuard,
} from "@yaoyao/http";
import { CoreProvidersModule } from "./core-providers.module.js";

/**
 * API host module — composition only.
 *
 * Wires @yaoyao/http controllers to @yaoyao/infrastructure implementations
 * (via the global CoreProvidersModule). Business rules live in
 * @yaoyao/domain; orchestration in @yaoyao/application; this host only
 * connects them.
 *
 * Guard order (all global): ThrottlerGuard first (abuse protection before
 * auth), then JwtAuthGuard (default-deny authentication). The
 * DomainExceptionFilter normalizes every error into the standard envelope.
 */
@Module({
  imports: [
    CoreProvidersModule,
    ApiModule,
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: 100,
      },
      {
        name: "login",
        ttl: 60_000,
        limit: 5,
      },
      {
        name: "register",
        ttl: 3_600_000,
        limit: 10,
      },
      {
        name: "refresh",
        ttl: 60_000,
        limit: 30,
      },
    ]),
  ],
  providers: [
    // Registered under their own class tokens (with APP_GUARD as useExisting
    // aliases) so integration tests can overrideGuard(ThrottlerGuard) /
    // overrideGuard(JwtAuthGuard) precisely. Overriding by the APP_GUARD
    // token would hit both guards at once and cannot target one.
    ThrottlerGuard,
    JwtAuthGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
