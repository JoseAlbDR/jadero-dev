import { systemPingV1 } from "@jadero/contracts";
import { createEnvelope, InMemoryMessageBus } from "@jadero/messaging";
import type { PinoLogger } from "@jadero/platform-nest";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { HeartbeatScope } from "../src/modules/heartbeat/application/heartbeat.unit-of-work.js";
import { HEARTBEAT_QUEUE, HeartbeatConsumer } from "../src/modules/heartbeat/heartbeat.consumer.js";
import { InMemoryHeartbeatUnitOfWork } from "../src/modules/heartbeat/infrastructure/in-memory-heartbeat.unit-of-work.js";

/** The consumer on the unit of work fake; the pool is only for the daily cleanup, unused here. */
function setup(uow = new InMemoryHeartbeatUnitOfWork()) {
  const debug = vi.fn();
  const log = { setContext: () => undefined, debug } as unknown as PinoLogger;
  const consumer = new HeartbeatConsumer(new InMemoryMessageBus(), {} as Pool, uow, log);
  return { consumer, uow, debug };
}

function delivery(envelope = createEnvelope(systemPingV1, { trigger: "heartbeat" }, "jadero/api")) {
  return { envelope, queue: HEARTBEAT_QUEUE, attempt: 1 };
}

describe("HeartbeatConsumer.handle (idempotent consumer on the unit of work)", () => {
  it("records the inbox row and the heartbeat on the first delivery", async () => {
    const { consumer, uow, debug } = setup();
    const first = delivery();
    await expect(consumer.handle(first)).resolves.toEqual({ kind: "done" });
    expect([...uow.inbox]).toEqual([`${HEARTBEAT_QUEUE}:${first.envelope.id}`]);
    expect(uow.heartbeats.get("jadero/api")).toEqual({
      source: "jadero/api",
      eventId: first.envelope.id,
      trigger: "heartbeat",
      seenAt: first.envelope.time,
    });
    expect(debug).not.toHaveBeenCalled();
  });

  it("ignores a duplicate: no second write, one debug line, still done", async () => {
    const { consumer, uow, debug } = setup();
    const first = delivery();
    await consumer.handle(first);
    const recorded = uow.heartbeats.get("jadero/api");
    const later = {
      ...first.envelope,
      data: { trigger: "manual" as const },
      time: new Date(Date.now() + 60_000).toISOString(),
    };
    await expect(consumer.handle(delivery(later))).resolves.toEqual({ kind: "done" });
    expect(uow.inbox.size).toBe(1);
    expect(uow.heartbeats.get("jadero/api")).toEqual(recorded);
    expect(debug).toHaveBeenCalledWith(
      { event_id: first.envelope.id, queue: HEARTBEAT_QUEUE },
      "duplicate ignored",
    );
  });

  it("leaves neither the inbox row nor the heartbeat when the work throws, so a retry starts clean", async () => {
    const uow = new InMemoryHeartbeatUnitOfWork();
    // The heartbeat write fails after the inbox row was written in the same unit of work.
    const failing = new (class extends InMemoryHeartbeatUnitOfWork {
      override run<T>(work: (scope: HeartbeatScope) => Promise<T>): Promise<T> {
        return uow.run((scope) =>
          work({
            inbox: scope.inbox,
            heartbeats: { record: async () => Promise.reject(new Error("upsert failed")) },
          }),
        );
      }
    })();
    const { consumer } = setup(failing);
    const first = delivery();
    await expect(consumer.handle(first)).rejects.toThrow("upsert failed");
    expect(uow.inbox.size).toBe(0);
    expect(uow.heartbeats.size).toBe(0);

    await setup(uow).consumer.handle(first);
    expect(uow.inbox.size).toBe(1);
    expect(uow.heartbeats.get("jadero/api")?.eventId).toBe(first.envelope.id);
  });

  it("never lets an older ping overwrite a newer one (delivery order is not guaranteed)", async () => {
    const { consumer, uow } = setup();
    const newer = delivery(createEnvelope(systemPingV1, { trigger: "manual" }, "jadero/api"));
    const older = delivery({
      ...createEnvelope(systemPingV1, { trigger: "heartbeat" }, "jadero/api"),
      time: "2026-01-01T00:00:00.000Z",
    });
    await consumer.handle(newer);
    await consumer.handle(older);
    expect(uow.inbox.size).toBe(2);
    expect(uow.heartbeats.get("jadero/api")?.eventId).toBe(newer.envelope.id);
  });
});
