import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
import { DiagnosticsModule } from "./diagnostics/diagnostics.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthModule } from "./health/health.module.js";
import { MemoriesModule } from "./memories/memories.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { UsersModule } from "./users/users.module.js";
import { YaoyaoModule } from "./yaoyao/yaoyao.module.js";

/**
 * @yaoyao/http feature modules — the Phase 4 API surface.
 *
 * Controllers translate transport shapes (DTOs) and invoke application
 * use cases. Guards enforce authentication; the error envelope is
 * standardized here. This layer never touches infrastructure directly —
 * persistence wiring happens in apps/* hosts.
 */
@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    YaoyaoModule,
    SessionsModule,
    EventsModule,
    MemoriesModule,
    DiagnosticsModule,
    ConversationsModule,
  ],
})
export class ApiModule {}
