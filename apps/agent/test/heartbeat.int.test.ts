import { fileURLToPath } from "node:url";
import { systemPingV1 } from "@jadero/contracts";
import { createEnvelope, done, InMemoryMessageBus, MessageBus } from "@jadero/messaging";
import { PG_POOL, runMigrations } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentConsumerEnv, toAgentConsumerConfig } from "../src/config/agent-config.js";
import { ConsumerModule } from "../src/consumer.module.js";
import { HEARTBEAT_QUEUE, HeartbeatConsumer } from "../src/modules/heartbeat/heartbeat.consumer.js";

let pool: pg.Pool;
let drop: () => Promise<void>;
let app: INestApplication;
const bus = new InMemoryMessageBus();

beforeAll(async () => {
  // As provisioning does for every `agent_*` database (ADR-027), the superuser creates `vector`
  // first, because it is not a trusted extension; the agent's first migration only asserts it.
  const database = await createTestDatabase({ superuserExtensions: ["vector"] });
  drop = database.drop;
  // agent's own migrations, as the deploy's one-off step applies them (WP-10 D2): the inbox and
  // heartbeat.broker_heartbeat come from drizzle/, never from hand-written test DDL.
  await runMigrations({
    service: "agent",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  pool = new pg.Pool({ connectionString: database.url, max: 4 });
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
      "SELECT source, last_event_id, last_trigger FROM heartbeat.broker_heartbeat",
    );
    expect(rows).toEqual([
      { source: "jadero/api", last_event_id: envelope.id, last_trigger: "heartbeat" },
    ]);
    expect(bus.deadLetters("agent.system.ping")).toEqual([]);
  });

  it("never lets an older ping overwrite a newer one (delivery order is not guaranteed)", async () => {
    const newer = createEnvelope(systemPingV1, { trigger: "manual" }, "jadero/api");
    const older = {
      ...createEnvelope(systemPingV1, { trigger: "heartbeat" }, "jadero/api"),
      time: "2026-01-01T00:00:00.000Z",
    };
    await bus.publish({ routingKey: systemPingV1.routingKey, envelope: newer });
    await bus.publish({ routingKey: systemPingV1.routingKey, envelope: older });
    await vi.waitFor(async () => {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM messaging.inbox WHERE event_id = $1",
        [older.id],
      );
      expect(rows[0].n).toBe(1);
    });
    const { rows } = await pool.query("SELECT last_event_id FROM heartbeat.broker_heartbeat");
    expect(rows).toEqual([{ last_event_id: newer.id }]);
  });
});

describe("agent consumer: the inbox row and the heartbeat share one transaction", () => {
  it("rolls the inbox row back when the heartbeat write fails, so the redelivery is processed", async () => {
    const consumer = app.get(HeartbeatConsumer);
    const envelope = createEnvelope(systemPingV1, { trigger: "manual" }, "jadero/rejected");
    // A real failure of the second write: Postgres rejects this one source (the role owns the table).
    await pool.query(
      "ALTER TABLE heartbeat.broker_heartbeat ADD CONSTRAINT reject_one_source CHECK (source <> 'jadero/rejected')",
    );
    try {
      await expect(
        consumer.handle({ envelope, queue: HEARTBEAT_QUEUE, attempt: 1 }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    } finally {
      await pool.query("ALTER TABLE heartbeat.broker_heartbeat DROP CONSTRAINT reject_one_source");
    }
    const inbox = "SELECT count(*)::int AS n FROM messaging.inbox WHERE event_id = $1";
    const heartbeat = "SELECT last_event_id FROM heartbeat.broker_heartbeat WHERE source = $1";
    expect((await pool.query(inbox, [envelope.id])).rows).toEqual([{ n: 0 }]);
    expect((await pool.query(heartbeat, [envelope.source])).rows).toEqual([]);
    // Had the inbox row committed on its own, this redelivery would be dropped as a duplicate.
    await expect(
      consumer.handle({ envelope, queue: HEARTBEAT_QUEUE, attempt: 2 }),
    ).resolves.toEqual(done());
    expect((await pool.query(inbox, [envelope.id])).rows).toEqual([{ n: 1 }]);
    expect((await pool.query(heartbeat, [envelope.source])).rows).toEqual([
      { last_event_id: envelope.id },
    ]);
  });
});
