import { MessageBus, OutboxRelay, RabbitMqMessageBus } from "@jadero/messaging";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { apiWorkerEnv, toApiWorkerConfig } from "../src/config/api-config.js";
import { WorkerModule } from "../src/worker.module.js";

const env = {
  PORT: "3011",
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  DATABASE_URL: "postgres://content:content@127.0.0.1:5432/content_dev",
  RABBITMQ_URL: "amqp://api:api@127.0.0.1:1/dev",
};

describe("api-worker config", () => {
  it("defaults SERVICE_NAME to api-worker and the heartbeat to 5 minutes", () => {
    expect(toApiWorkerConfig(apiWorkerEnv.parse(env))).toMatchObject({
      serviceName: "api-worker",
      rabbitmqUrl: "amqp://api:api@127.0.0.1:1/dev",
      heartbeatIntervalMs: 300_000,
    });
  });

  it("never holds the read-only credential of the public reads", () => {
    expect(toApiWorkerConfig(apiWorkerEnv.parse(env))).not.toHaveProperty("databaseReadUrl");
  });

  it("refuses to start without the broker URL", () => {
    const { RABBITMQ_URL: _, ...withoutBroker } = env;
    expect(apiWorkerEnv.safeParse(withoutBroker).success).toBe(false);
  });
});

describe("WorkerModule", () => {
  it("wires the RabbitMQ bus behind the MessageBus port and the relay, without waiting for the broker", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(toApiWorkerConfig(apiWorkerEnv.parse(env)))],
    }).compile();
    expect(moduleRef.get(MessageBus)).toBeInstanceOf(RabbitMqMessageBus);
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
    await moduleRef.close();
  });
});
