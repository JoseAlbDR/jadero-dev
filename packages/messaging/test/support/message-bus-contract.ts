import { type EnvelopeOf, systemPingV1 } from "@jadero/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DeadLetter,
  type Delivery,
  dead,
  done,
  type MessageBus,
  retry,
} from "../../src/index.js";

/** What a contract run needs from an adapter: the bus plus a way to look at its side queues. */
export interface BusHarness {
  readonly bus: MessageBus;
  deadLetters(queue: string): Promise<readonly DeadLetter[]>;
  unrouted(): Promise<readonly { routingKey: string }[]>;
  close(): Promise<void>;
}

/** Short tiers so a run takes milliseconds; the policy is the same as with 10 s, 1 min, 10 min. */
export const TEST_RETRY_TIERS_MS = [20, 40, 60] as const;

type Ping = EnvelopeOf<typeof systemPingV1>;

let sequence = 0;
function ping(trigger: "manual" | "heartbeat" = "manual"): Ping {
  sequence += 1;
  return {
    specversion: "1.0",
    id: `0199b1c4-7e2a-7c3d-9f10-${String(sequence).padStart(12, "0")}`,
    source: "jadero/api",
    type: systemPingV1.type,
    time: "2026-10-04T10:15:02.114Z",
    datacontenttype: "application/json",
    data: { trigger },
  };
}

/**
 * The behavior every `MessageBus` adapter must show (ADR-009: adapters are covered by their
 * contract suites). The in-memory adapter runs it in unit tests, the RabbitMQ adapter against a
 * real broker, so a test written against the in-memory bus means the same thing in production.
 * @param name the adapter's name in the test titles.
 * @param createHarness builds a fresh adapter with the given retry tiers.
 */
export function messageBusContract(
  name: string,
  createHarness: (options: { retryTiersMs: readonly number[] }) => Promise<BusHarness>,
): void {
  describe(`MessageBus contract: ${name}`, () => {
    let harness: BusHarness;
    beforeEach(async () => {
      harness = await createHarness({ retryTiersMs: TEST_RETRY_TIERS_MS });
    });
    afterEach(async () => {
      await harness.close();
    });

    function record(queue: string, outcomes: Array<"done" | "retry" | "dead" | "throw"> = []) {
      const seen: Delivery<Ping>[] = [];
      harness.bus.subscribe({
        queue,
        contract: systemPingV1,
        handle: async (delivery) => {
          seen.push(delivery);
          const next = outcomes[seen.length - 1] ?? "done";
          if (next === "throw") throw new Error("database unavailable");
          if (next === "retry") return retry("try later");
          if (next === "dead") return dead("cannot process");
          return done();
        },
      });
      return seen;
    }

    it("delivers a published event to the subscribed queue, parsed and typed", async () => {
      const seen = record("test.a");
      await harness.bus.start();
      const event = ping();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: event });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ attempt: 1, queue: "test.a", envelope: { id: event.id } });
      expect(seen[0]?.envelope.data.trigger).toBe("manual");
    });

    it("gives every subscribed queue its own copy (publish-subscribe)", async () => {
      const a = record("test.a");
      const b = record("test.b");
      await harness.bus.start();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: ping() });
      await vi.waitFor(() => expect([a.length, b.length]).toEqual([1, 1]));
    });

    it("keeps messages for a stopped consumer and delivers them when it starts", async () => {
      const seen = record("test.a");
      await harness.bus.start();
      await harness.bus.stop();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: ping() });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toHaveLength(0);
      await harness.bus.start();
      await vi.waitFor(() => expect(seen).toHaveLength(1));
    });

    it("redelivers a retry to the failing queue only, with the next attempt number", async () => {
      const failing = record("test.a", ["retry", "done"]);
      const healthy = record("test.b");
      await harness.bus.start();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: ping() });
      await vi.waitFor(() => expect(failing.map((d) => d.attempt)).toEqual([1, 2]));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(healthy).toHaveLength(1);
    });

    it("treats a thrown error as a retry", async () => {
      const seen = record("test.a", ["throw", "done"]);
      await harness.bus.start();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: ping() });
      await vi.waitFor(() => expect(seen.map((d) => d.attempt)).toEqual([1, 2]));
    });

    it("dead-letters after the last retry tier, and delivers it no more", async () => {
      const seen = record("test.a", ["retry", "retry", "retry", "retry", "done"]);
      await harness.bus.start();
      const event = ping();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: event });
      await vi.waitFor(async () => expect(await harness.deadLetters("test.a")).toHaveLength(1));
      const [letter] = await harness.deadLetters("test.a");
      expect(letter).toMatchObject({ attempts: 4, envelope: { id: event.id } });
      expect(letter?.reason).toMatch(/retries exhausted/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(seen).toHaveLength(4);
    });

    it("dead-letters a dead outcome at once", async () => {
      const seen = record("test.a", ["dead"]);
      await harness.bus.start();
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: ping() });
      await vi.waitFor(async () => expect(await harness.deadLetters("test.a")).toHaveLength(1));
      expect(seen).toHaveLength(1);
    });

    it("dead-letters data that breaks the contract without calling the handler", async () => {
      const seen = record("test.a");
      await harness.bus.start();
      const bad = { ...ping(), data: { trigger: "cron" } } as unknown as Ping;
      await harness.bus.publish({ routingKey: systemPingV1.routingKey, envelope: bad });
      await vi.waitFor(async () => expect(await harness.deadLetters("test.a")).toHaveLength(1));
      const [letter] = await harness.deadLetters("test.a");
      expect(letter?.reason).toBe("invalid dev.jadero.system.ping.v1: data.trigger");
      expect(seen).toHaveLength(0);
    });

    it("keeps a message nobody is bound to instead of dropping it", async () => {
      record("test.a");
      await harness.bus.start();
      await harness.bus.publish({ routingKey: "system.pong.v1", envelope: ping() });
      await vi.waitFor(async () =>
        expect((await harness.unrouted()).map((m) => m.routingKey)).toEqual(["system.pong.v1"]),
      );
    });
  });
}
