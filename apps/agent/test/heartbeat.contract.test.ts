import type { EventContract } from "@jadero/contracts";
import pingFixture from "@jadero/contracts/fixtures/system.ping.v1.json" with { type: "json" };
import { MessageBus, type OutgoingMessage, type Subscription } from "@jadero/messaging";
import type { PinoLogger } from "@jadero/platform-nest";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { HEARTBEAT_QUEUE, HeartbeatConsumer } from "../src/modules/heartbeat/heartbeat.consumer.js";
import { HeartbeatRepository } from "../src/modules/heartbeat/heartbeat.repository.js";

/**
 * Consumer-side contract test (ADR-009 "contract tests between services", ADR-029 rule 4, WP-6
 * D6): the producer's example of `system.ping.v1`, shipped by `@jadero/contracts`, must parse with
 * the contract this consumer actually registers on the bus, and carry every field the handler maps
 * to the heartbeat record. A consumer that starts requiring something the producer does not send
 * fails here, in `agent`, even when `packages/contracts` did not change; a change to the fixture or
 * the contract selects this test too, because `agent` depends on `@jadero/contracts`.
 *
 * Each new consumer adds one such test per event it subscribes to.
 */

type AnySubscription = Subscription<EventContract<string, z.ZodType>>;

/** A bus that only records what is subscribed; nothing is delivered. */
class CapturingBus extends MessageBus {
  readonly subscriptions: AnySubscription[] = [];

  override async publish(_message: OutgoingMessage): Promise<void> {}

  override subscribe<C extends EventContract<string, z.ZodType>>(
    subscription: Subscription<C>,
  ): void {
    this.subscriptions.push(subscription as unknown as AnySubscription);
  }

  override async start(): Promise<void> {}
  override async stop(): Promise<void> {}
  override async close(): Promise<void> {}
}

/** The subscription `HeartbeatConsumer` registers at module init, captured on a fake bus. */
function registeredSubscription(): AnySubscription {
  const bus = new CapturingBus();
  const log = { setContext: () => undefined } as unknown as PinoLogger;
  new HeartbeatConsumer(bus, {} as Pool, new HeartbeatRepository(), log).onModuleInit();
  expect(bus.subscriptions).toHaveLength(1);
  const [subscription] = bus.subscriptions;
  if (!subscription) throw new Error("HeartbeatConsumer registered no subscription");
  return subscription;
}

describe("HeartbeatConsumer contract (consumer side of system.ping.v1)", () => {
  it("subscribes on its queue with the contract whose type the producer's fixture carries", () => {
    const subscription = registeredSubscription();
    expect(subscription.queue).toBe(HEARTBEAT_QUEUE);
    // The bus routes each delivery to the subscription whose contract type matches the envelope.
    expect(subscription.contract.type).toBe(pingFixture.type);
  });

  it("parses the producer's fixture and finds every field the handler maps to the heartbeat", () => {
    const { contract } = registeredSubscription();
    const parsed = contract.envelope.safeParse(structuredClone(pingFixture));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const envelope = parsed.data as Record<string, unknown> & { data: Record<string, unknown> };

    // The fields `HeartbeatConsumer.handle` reads: source, id, data.trigger and time.
    expect(envelope.source).toEqual(expect.any(String));
    expect(envelope.id).toEqual(expect.any(String));
    expect(envelope.data.trigger).toEqual(expect.any(String));
    expect(envelope.time).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(envelope.time as string))).toBe(false);
  });
});
