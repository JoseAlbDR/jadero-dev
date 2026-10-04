import { configureApp, loadConfig } from "@jadero/platform-nest";
import { NestFactory } from "@nestjs/core";
import { agentConsumerEnv, toAgentConsumerConfig } from "./config/agent-config.js";
import { ConsumerModule } from "./consumer.module.js";

// Fail fast, as in main.ts: a bad environment exits before any module is built.
const config = toAgentConsumerConfig(loadConfig(agentConsumerEnv));

const app = configureApp(
  await NestFactory.create(ConsumerModule.forRoot(config), { bufferLogs: true }),
);
await app.listen(config.port);
