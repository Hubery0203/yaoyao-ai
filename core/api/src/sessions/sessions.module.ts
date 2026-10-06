import { Module } from "@nestjs/common";
import { SessionsController } from "./sessions.controller.js";

@Module({ controllers: [SessionsController] })
export class SessionsModule {}
