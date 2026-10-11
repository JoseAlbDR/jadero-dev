import { InMemoryMessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { describe, expect, it } from "vitest";
import { BrokerReadinessCheck } from "../src/modules/heartbeat/broker.readiness-check.js";

/**
 * A stand-in that passes `instanceof RabbitMqMessageBus` without opening a connection: the real
 * constructor dials the broker at once. Only `isConnected` is read by the check.
 * @param connected what `isConnected()` answers.
 * @returns the stand-in bus.
 */
function rabbitBus(connected: boolean): RabbitMqMessageBus {
  return Object.create(RabbitMqMessageBus.prototype, {
    isConnected: { value: () => connected },
  }) as RabbitMqMessageBus;
}

describe("BrokerReadinessCheck (consumer process readiness, WP-5 W1)", () => {
  it("is named broker, the key the readiness endpoint reports", () => {
    expect(new BrokerReadinessCheck(new InMemoryMessageBus()).name).toBe("broker");
  });

  it("is ready while the RabbitMQ connection is up", async () => {
    await expect(new BrokerReadinessCheck(rabbitBus(true)).check()).resolves.toBeUndefined();
  });

  it("fails while the RabbitMQ connection is down, so the process is taken out of rotation", async () => {
    await expect(new BrokerReadinessCheck(rabbitBus(false)).check()).rejects.toThrow(
      "broker not connected",
    );
  });

  it("is always ready on the in-memory bus, which has no connection to lose", async () => {
    await expect(
      new BrokerReadinessCheck(new InMemoryMessageBus()).check(),
    ).resolves.toBeUndefined();
  });
});
