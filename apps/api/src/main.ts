import { configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { apiEnv, toApiConfig } from "./config/api-config.js";

// Fail fast: a bad environment exits here, before any module is built.
const config = toApiConfig(loadConfig(apiEnv));

const app = configureApp(await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true }));
await app.listen(config.port);
