import { systemPingV1 } from "@jadero/contracts";
import { connect } from "amqplib";
import { describe, expect, inject, it, vi } from "vitest";
import {
  ATTEMPT_HEADER,
  DEAD_REASON_HEADER,
  type DeadLetter,
  dead,
  deadLetterQueueName,
  done,
  EVENTS_EXCHANGE,
  RabbitMqMessageBus,
  retry,
  retryQueueName,
  UNROUTED,
} from "../src/index.js";
import { messageBusContract } from "./support/message-bus-contract.js";
import { TEST_RETRY_TIERS_MS } from "./support/tiers.js";

const silent = { log() {}, error() {}, warn() {}, debug() {}, verbose() {} };
const TEST_QUEUES = ["test.a", "test.b"].flatMap((q) => [
  q,
  deadLetterQueueName(q),
  ...TEST_RETRY_TIERS_MS.map((ms) => retryQueueName(q, ms)),
]);

/**
 * Sets a policy on one queue through the management API, as an operator would during an incident.
 * The test topology gives dead-letter queues no policy, so this one applies alone.
 */
async function setQueuePolicy(name: string, queue: string, definition: Record<string, unknown>) {
  const response = await fetch(`${inject("managementUrl")}/policies/test/${name}`, {
    method: "PUT",
    headers: { authorization: ADMIN_AUTH, "content-type": "application/json" },
    body: JSON.stringify({ pattern: `^${queue}$`, definition, priority: 20, "apply-to": "queues" }),
  });
  expect(response.ok).toBe(true);
}

/** Removes a policy set by `setQueuePolicy`. */
async function clearQueuePolicy(name: string) {
  await fetch(`${inject("managementUrl")}/policies/test/${name}`, {
    method: "DELETE",
    headers: { authorization: ADMIN_AUTH },
  });
}

const ADMIN_AUTH = `Basic ${Buffer.from("admin:admin").toString("base64")}`;

/** A valid `system.ping.v1` body with the given id. */
function pingBody(id: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      specversion: "1.0",
      id,
      source: "jadero/api",
      type: systemPingV1.type,
      time: "2026-10-11T10:15:02.114Z",
      datacontenttype: "application/json",
      data: { trigger: "manual" },
    }),
  );
}

messageBusContract("rabbitmq", async ({ retryTiersMs }) => {
  const bus = new RabbitMqMessageBus({ uri: inject("serviceUri"), retryTiersMs, logger: silent });
  const admin = await connect(inject("adminUri"));
  const channel = await admin.createChannel();
  const dead = new Map<string, DeadLetter[]>();
  const unrouted: { routingKey: string }[] = [];
  return {
    bus,
    async deadLetters(queue) {
      const list = dead.get(queue) ?? [];
      for (let m = await channel.get(deadLetterQueueName(queue), { noAck: true }); m; ) {
        list.push({
          envelope: JSON.parse(m.content.toString("utf8")),
          reason: String(m.properties.headers?.[DEAD_REASON_HEADER]),
          attempts: Number(m.properties.headers?.[ATTEMPT_HEADER]),
        });
        m = await channel.get(deadLetterQueueName(queue), { noAck: true });
      }
      dead.set(queue, list);
      return list;
    },
    async unrouted() {
      for (let m = await channel.get(UNROUTED, { noAck: true }); m; ) {
        unrouted.push({ routingKey: m.fields.routingKey });
        m = await channel.get(UNROUTED, { noAck: true });
      }
      return unrouted;
    },
    async close() {
      await bus.close();
      for (const queue of [...TEST_QUEUES, UNROUTED]) await channel.purgeQueue(queue);
      await admin.close();
    },
  };
});

describe("RabbitMQ adapter edge cases", () => {
  it("dead-letters a body that is not JSON, with the reason, instead of requeueing it", async () => {
    const bus = new RabbitMqMessageBus({
      uri: inject("serviceUri"),
      retryTiersMs: TEST_RETRY_TIERS_MS,
      logger: silent,
    });
    bus.subscribe({ queue: "test.a", contract: systemPingV1, handle: async () => done() });
    await bus.start();
    await bus.ready();
    const admin = await connect(inject("adminUri"));
    const channel = await admin.createConfirmChannel();
    channel.publish(EVENTS_EXCHANGE, systemPingV1.routingKey, Buffer.from("not json"));
    await channel.waitForConfirms();
    await vi.waitFor(async () => {
      const letter = await channel.get(deadLetterQueueName("test.a"), { noAck: true });
      expect(letter && String(letter.properties.headers?.[DEAD_REASON_HEADER])).toBe(
        "invalid envelope: (root)",
      );
    });
    await bus.close();
    for (const queue of [...TEST_QUEUES, UNROUTED]) await channel.purgeQueue(queue);
    await admin.close();
  });

  it("holds and puts back a delivery whose dead-letter copy the broker refuses, then copies it once", async () => {
    // The DLQ refuses every publish (the broker nacks the copy), as when a queue is full or the
    // broker is in trouble: the copy is not confirmed, so the delivery must not be acked. A quorum
    // queue's limit is soft (it refuses only once it holds more than the limit), so one filler
    // message puts it over a limit of 0.
    const dlq = deadLetterQueueName("test.a");
    const admin = await connect(inject("adminUri"));
    const channel = await admin.createConfirmChannel();
    await setQueuePolicy("refuse-dlq", dlq, { "max-length": 0, overflow: "reject-publish" });
    channel.sendToQueue(dlq, Buffer.from("filler"));
    await channel.waitForConfirms();
    const redeliverDelayMs = 200;
    const bus = new RabbitMqMessageBus({
      uri: inject("serviceUri"),
      retryTiersMs: TEST_RETRY_TIERS_MS,
      redeliverDelayMs,
      logger: silent,
    });
    const runs: number[] = [];
    bus.subscribe({
      queue: "test.a",
      contract: systemPingV1,
      handle: async () => {
        runs.push(Date.now());
        return dead("bad payload");
      },
    });
    try {
      await bus.start();
      await bus.ready();
      channel.publish(
        EVENTS_EXCHANGE,
        systemPingV1.routingKey,
        pingBody("0199b1c4-7e2a-7c3d-9f10-00000000c0f1"),
        { messageId: "0199b1c4-7e2a-7c3d-9f10-00000000c0f1" },
      );
      await channel.waitForConfirms();

      // Put back, not acked and not lost: the broker delivers it again and again, each time after
      // the hold, never in a tight loop, and nothing but the filler is in the DLQ.
      await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      const gaps = runs.slice(1).map((at, i) => at - (runs[i] ?? at));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(redeliverDelayMs - 10);
      expect((await channel.checkQueue(dlq)).messageCount).toBe(1);

      // The broker accepts again: the next run copies it to the DLQ and acks, exactly once.
      await clearQueuePolicy("refuse-dlq");
      await vi.waitFor(async () => expect((await channel.checkQueue(dlq)).messageCount).toBe(2), {
        timeout: 5000,
      });
      const runsWhenCopied = runs.length;
      await new Promise((resolve) => setTimeout(resolve, 3 * redeliverDelayMs));
      expect(runs.length).toBe(runsWhenCopied);
      expect((await channel.checkQueue(dlq)).messageCount).toBe(2);
      expect((await channel.checkQueue("test.a")).messageCount).toBe(0);
      await channel.get(dlq, { noAck: true }); // the filler
      const letter = await channel.get(dlq, { noAck: true });
      expect(letter && String(letter.properties.headers?.[DEAD_REASON_HEADER])).toBe("bad payload");
    } finally {
      await clearQueuePolicy("refuse-dlq");
      await bus.close();
      for (const queue of [...TEST_QUEUES, UNROUTED]) await channel.purgeQueue(queue);
      await admin.close();
    }
  });

  it("treats a malformed attempt header as the first attempt, so a retry keeps its tiers", async () => {
    const bus = new RabbitMqMessageBus({
      uri: inject("serviceUri"),
      retryTiersMs: TEST_RETRY_TIERS_MS,
      logger: silent,
    });
    const attempts: number[] = [];
    bus.subscribe({
      queue: "test.a",
      contract: systemPingV1,
      handle: async (delivery) => {
        attempts.push(delivery.attempt);
        return attempts.length === 1 ? retry("db down") : done();
      },
    });
    await bus.start();
    await bus.ready();
    const admin = await connect(inject("adminUri"));
    const channel = await admin.createConfirmChannel();
    try {
      channel.publish(
        EVENTS_EXCHANGE,
        systemPingV1.routingKey,
        pingBody("0199b1c4-7e2a-7c3d-9f10-00000000a77e"),
        { headers: { [ATTEMPT_HEADER]: "abc" } },
      );
      await channel.waitForConfirms();
      // Number("abc") would be NaN, and the policy would dead-letter it with no retry at all.
      await vi.waitFor(() => expect(attempts).toEqual([1, 2]));
      expect((await channel.checkQueue(deadLetterQueueName("test.a"))).messageCount).toBe(0);
    } finally {
      await bus.close();
      for (const queue of [...TEST_QUEUES, UNROUTED]) await channel.purgeQueue(queue);
      await admin.close();
    }
  });
});

describe("RabbitMQ permissions (least privilege)", () => {
  it("a service user cannot declare a queue: the topology lives only in definitions.json", async () => {
    const connection = await connect(inject("serviceUri"));
    const channel = await connection.createChannel();
    channel.on("error", () => {});
    await expect(channel.assertQueue("test.rogue", { durable: true })).rejects.toThrow(
      /ACCESS_REFUSED/,
    );
    await connection.close().catch(() => {});
  });
});
