import { configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { agentEnv, toAgentConfig } from "./config/agent-config.js";

// Fail fast: a bad environment exits here, before any module is built.
const config = toAgentConfig(loadConfig(agentEnv));

const app = configureApp(await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true }));
await app.listen(config.port);
