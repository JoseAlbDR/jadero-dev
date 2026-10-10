import { APP_OPTIONS, configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { apiWorkerEnv, toApiWorkerConfig } from "./config/api-config.js";
import { WorkerModule } from "./worker.module.js";

// Fail fast, as in main.ts: a bad environment exits before any module is built.
const env = loadConfig(apiWorkerEnv);
const config = toApiWorkerConfig(env);

const app = configureApp(
  await NestFactory.create<NestExpressApplication>(WorkerModule.forRoot(config), APP_OPTIONS),
  env,
);
await app.listen(config.port);
