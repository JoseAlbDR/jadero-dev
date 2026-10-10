import { JADERO_QUEUES, MessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { APP_OPTIONS, configureApp, PG_POOL } from "@jadero/platform-nest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
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

  it("sizes the pool at 6 by default and reads DATABASE_POOL_MAX", () => {
    expect(toAgentConfig(agentEnv.parse(base)).databasePoolMax).toBe(6);
    expect(toAgentConfig(agentEnv.parse({ ...base, DATABASE_POOL_MAX: "8" })).databasePoolMax).toBe(
      8,
    );
    expect(agentEnv.safeParse({ ...base, DATABASE_POOL_MAX: "0" }).success).toBe(false);
  });

  it("the consumer refuses to start without the broker URL", () => {
    expect(agentConsumerEnv.safeParse(base).success).toBe(false);
  });
});

describe("agent HTTP process with its database down", () => {
  it("boots, is live, and is not ready", async () => {
    const env = agentEnv.parse(base);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(toAgentConfig(env))],
    }).compile();
    const app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS),
      env,
    );
    await app.init();
    expect((await request(app.getHttpServer()).get("/health/live")).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/health/ready")).status).toBe(503);
    const pool = app.get<Pool>(PG_POOL);
    expect(pool.options.max).toBe(6);
    await app.close();
    expect(pool.ended).toBe(true);
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
