import { systemPingV1 } from "@jadero/contracts";
import { connect } from "amqplib";
import { describe, expect, inject, it, vi } from "vitest";
import {
  ATTEMPT_HEADER,
  DEAD_REASON_HEADER,
  type DeadLetter,
  deadLetterQueueName,
  done,
  EVENTS_EXCHANGE,
  RabbitMqMessageBus,
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
