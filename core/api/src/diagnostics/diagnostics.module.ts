import { Module } from "@nestjs/common";
import { DiagnosticsController } from "./diagnostics.controller.js";

@Module({ controllers: [DiagnosticsController] })
export class DiagnosticsModule {}
