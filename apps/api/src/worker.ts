import { configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import { apiWorkerEnv, toApiWorkerConfig } from "./config/api-config.js";
import { WorkerModule } from "./worker.module.js";

// Fail fast, as in main.ts: a bad environment exits before any module is built.
const config = toApiWorkerConfig(loadConfig(apiWorkerEnv));

const app = configureApp(
  await NestFactory.create(WorkerModule.forRoot(config), { bufferLogs: true }),
);
await app.listen(config.port);
