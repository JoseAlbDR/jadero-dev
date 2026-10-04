import { readFileSync } from "node:fs";
import { systemPingV1 } from "@jadero/contracts";
import {
  createEnvelope,
  InMemoryMessageBus,
  MessageBus,
  migrateMessagingSchema,
} from "@jadero/messaging";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentConsumerEnv, toAgentConsumerConfig } from "../src/config/agent-config.js";
import { ConsumerModule } from "../src/consumer.module.js";
import { PG_POOL } from "../src/modules/platform/index.js";
import { createTestDatabase } from "./setup/test-database.js";

let pool: pg.Pool;
let drop: () => Promise<void>;
let app: INestApplication;
const bus = new InMemoryMessageBus();

beforeAll(async () => {
  const database = await createTestDatabase();
  drop = database.drop;
  pool = new pg.Pool({ connectionString: database.url, max: 4 });
  await migrateMessagingSchema(pool);
  await pool.query(
    readFileSync(new URL("../sql/0001_broker_heartbeat.sql", import.meta.url), "utf8"),
  );
  const config = toAgentConsumerConfig(
    agentConsumerEnv.parse({
      PORT: "3012",
      NODE_ENV: "test",
      LOG_LEVEL: "fatal",
      DATABASE_URL: database.url,
      RABBITMQ_URL: "amqp://agent:agent@127.0.0.1:1/dev",
    }),
  );
  const moduleRef = await Test.createTestingModule({ imports: [ConsumerModule.forRoot(config)] })
    .overrideProvider(MessageBus)
    .useValue(bus)
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await drop();
});

describe("agent consumer: system.ping.v1 (idempotent consumer)", () => {
  it("records the heartbeat once, even when the same event arrives twice", async () => {
    const envelope = createEnvelope(systemPingV1, { trigger: "heartbeat" }, "jadero/api");
    await bus.publish({ routingKey: systemPingV1.routingKey, envelope });
    await bus.publish({ routingKey: systemPingV1.routingKey, envelope });
    await vi.waitFor(async () => {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM messaging.inbox");
      expect(rows[0].n).toBe(1);
    });
    const { rows } = await pool.query(
      "SELECT source, last_event_id, last_trigger FROM broker_heartbeat",
    );
    expect(rows).toEqual([
      { source: "jadero/api", last_event_id: envelope.id, last_trigger: "heartbeat" },
    ]);
    expect(bus.deadLetters("agent.system.ping")).toEqual([]);
  });
});
