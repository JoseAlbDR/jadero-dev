import { APP_OPTIONS, configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { agentConsumerEnv, toAgentConsumerConfig } from "./config/agent-config.js";
import { ConsumerModule } from "./consumer.module.js";

// Fail fast, as in main.ts: a bad environment exits before any module is built.
const env = loadConfig(agentConsumerEnv);
const config = toAgentConsumerConfig(env);

const app = configureApp(
  await NestFactory.create<NestExpressApplication>(ConsumerModule.forRoot(config), APP_OPTIONS),
  env,
);
await app.listen(config.port);
