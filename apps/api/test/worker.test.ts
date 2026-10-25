import { MessageBus, OutboxRelay, RabbitMqMessageBus } from "@jadero/messaging";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { apiWorkerEnv, toApiWorkerConfig } from "../src/config/api-config.js";
import { HttpWebCache } from "../src/modules/revalidation/http-web-cache.js";
import { WebCache } from "../src/modules/revalidation/web-cache.js";
import { WorkerModule } from "../src/worker.module.js";

const env = {
  PORT: "3011",
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  DATABASE_URL: "postgres://content_dev:content_dev@127.0.0.1:5432/content_dev",
  RABBITMQ_URL: "amqp://api:api@127.0.0.1:1/dev",
  WEB_REVALIDATE_URL: "http://127.0.0.1:3000/api/revalidate",
  REVALIDATE_SECRET: "a-test-secret-of-at-least-32-characters",
};

describe("api-worker config", () => {
  it("defaults SERVICE_NAME to api-worker and the heartbeat to 5 minutes", () => {
    expect(toApiWorkerConfig(apiWorkerEnv.parse(env))).toMatchObject({
      serviceName: "api-worker",
      host: "127.0.0.1",
      rabbitmqUrl: "amqp://api:api@127.0.0.1:1/dev",
      heartbeatIntervalMs: 300_000,
    });
  });

  it("reads web's revalidation route and key, and a pool of 6, above the consumer's prefetch of 2", () => {
    expect(toApiWorkerConfig(apiWorkerEnv.parse(env))).toMatchObject({
      databasePoolMax: 6,
      webRevalidateUrl: "http://127.0.0.1:3000/api/revalidate",
      revalidateSecret: env.REVALIDATE_SECRET,
    });
  });

  it.each(["WEB_REVALIDATE_URL", "REVALIDATE_SECRET"] as const)(
    "refuses to start without %s",
    (name) => {
      const { [name]: _, ...without } = env;
      expect(apiWorkerEnv.safeParse(without).success).toBe(false);
    },
  );

  it("refuses a short revalidation secret and a route that is not http(s)", () => {
    expect(apiWorkerEnv.safeParse({ ...env, REVALIDATE_SECRET: "secret" }).success).toBe(false);
    expect(apiWorkerEnv.safeParse({ ...env, WEB_REVALIDATE_URL: "ftp://web/x" }).success).toBe(
      false,
    );
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
  it("wires the RabbitMQ bus behind the MessageBus port, the relay and the signed web cache, without waiting for the broker", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(toApiWorkerConfig(apiWorkerEnv.parse(env)))],
    }).compile();
    expect(moduleRef.get(MessageBus)).toBeInstanceOf(RabbitMqMessageBus);
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
    expect(moduleRef.get(WebCache)).toBeInstanceOf(HttpWebCache);
    await moduleRef.close();
  });
});
