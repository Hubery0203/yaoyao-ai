import { Module } from "@nestjs/common";
import { MemoriesController } from "./memories.controller.js";

@Module({ controllers: [MemoriesController] })
export class MemoriesModule {}
