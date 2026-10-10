import { APP_OPTIONS, configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { agentEnv, toAgentConfig } from "./config/agent-config.js";

// Fail fast: a bad environment exits here, before any module is built.
const env = loadConfig(agentEnv);
const config = toAgentConfig(env);

const app = configureApp(
  await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), APP_OPTIONS),
  env,
);
await app.listen(config.port);
