import { NestFactory } from "@nestjs/core";
import { createLogger, loadConfig } from "@yaoyao/infrastructure";
import { AppModule } from "./app.module.js";
import { applyAppDefaults } from "./app.setup.js";

/** API host bootstrap — composition and transport only, no business rules. */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config).child({ host: "api" });

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });
  applyAppDefaults(app);

  await app.listen(config.PORT);
  logger.info({ port: config.PORT }, "yaoyao-ai api listening");
}

bootstrap().catch((err: unknown) => {
  // Bootstrap failure must be loud — never silently run misconfigured.
  console.error("API bootstrap failed:", err);
  process.exit(1);
});
