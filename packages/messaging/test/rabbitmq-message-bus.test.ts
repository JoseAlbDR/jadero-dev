import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RabbitMqMessageBus } from "../src/index.js";
import { POSTGRES_IMAGE, RABBITMQ_IMAGE } from "./setup/images.js";

const silent = { log() {}, error() {}, warn() {}, debug() {}, verbose() {} };

describe("RabbitMqMessageBus with the broker down", () => {
  // The WP-3 spike found golevelup's init blocking while the broker is down. The adapter starts
  // without waiting, and a publish fails after its timeout instead of hanging, so the relay can
  // record the attempt and back off (ADR-012).
  it("starts without waiting for the broker, and a publish fails after its timeout", async () => {
    const bus = new RabbitMqMessageBus({
      uri: "amqp://nobody:nothing@127.0.0.1:1/none",
      publishTimeoutMs: 200,
      logger: silent,
    });
    const started = Date.now();
    await bus.start();
    expect(Date.now() - started).toBeLessThan(100);
    expect(bus.isConnected()).toBe(false);
    await expect(
      bus.publish({
        routingKey: "system.ping.v1",
        envelope: {
          specversion: "1.0",
          id: "0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f",
          source: "jadero/api",
          type: "dev.jadero.system.ping.v1",
          time: "2026-10-04T10:15:02.114Z",
          datacontenttype: "application/json",
          data: { trigger: "manual" },
        },
      }),
    ).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(2000);
    await bus.close();
  });
});

describe("test images", () => {
  it("use the same RabbitMQ and Postgres tags as the dev stack, so dev and tests cannot drift", () => {
    const compose = readFileSync(
      new URL("../../../infra/compose/compose.dev.yml", import.meta.url),
      "utf8",
    );
    expect(compose).toContain(`image: ${RABBITMQ_IMAGE}`);
    expect(compose).toContain(`image: ${POSTGRES_IMAGE}`);
  });
});
