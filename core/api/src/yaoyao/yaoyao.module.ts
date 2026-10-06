import { Module } from "@nestjs/common";
import { YaoYaoController } from "./yaoyao.controller.js";

@Module({ controllers: [YaoYaoController] })
export class YaoyaoModule {}
