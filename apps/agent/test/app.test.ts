import { JADERO_QUEUES, MessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { configureApp } from "@jadero/platform-nest";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  agentConsumerEnv,
  agentEnv,
  toAgentConfig,
  toAgentConsumerConfig,
} from "../src/config/agent-config.js";
import { ConsumerModule } from "../src/consumer.module.js";
import { HEARTBEAT_QUEUE } from "../src/modules/heartbeat/index.js";

const base = {
  PORT: "3002",
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  DATABASE_URL: "postgres://agent:agent@127.0.0.1:1/agent_dev",
};

describe("agent config", () => {
  it("defaults SERVICE_NAME to agent, and to agent-consumer for the consumer process", () => {
    expect(toAgentConfig(agentEnv.parse(base)).serviceName).toBe("agent");
    const consumer = toAgentConsumerConfig(
      agentConsumerEnv.parse({ ...base, RABBITMQ_URL: "amqp://agent:agent@127.0.0.1:1/dev" }),
    );
    expect(consumer).toMatchObject({
      serviceName: "agent-consumer",
      rabbitmqUrl: "amqp://agent:agent@127.0.0.1:1/dev",
    });
  });

  it("the consumer refuses to start without the broker URL", () => {
    expect(agentConsumerEnv.safeParse(base).success).toBe(false);
  });
});

describe("agent HTTP process with its database down", () => {
  it("boots, is live, and is not ready", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(toAgentConfig(agentEnv.parse(base)))],
    }).compile();
    const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(503);
    await app.close();
  });
});

describe("agent consumer process", () => {
  it("reads a queue the topology defines for agent", () => {
    expect(JADERO_QUEUES).toContainEqual(
      expect.objectContaining({ name: HEARTBEAT_QUEUE, service: "agent" }),
    );
  });

  it("wires the RabbitMQ bus behind the MessageBus port, without waiting for the broker", async () => {
    const config = toAgentConsumerConfig(
      agentConsumerEnv.parse({ ...base, RABBITMQ_URL: "amqp://agent:agent@127.0.0.1:1/dev" }),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [ConsumerModule.forRoot(config)],
    }).compile();
    expect(moduleRef.get(MessageBus)).toBeInstanceOf(RabbitMqMessageBus);
    await moduleRef.close();
  });
});
