import { systemPingV1 } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { backoffSeconds, createEnvelope, uuidv7 } from "../src/index.js";

describe("uuidv7", () => {
  it("is a version 7 UUID whose first 48 bits are the time", () => {
    const id = uuidv7(Date.UTC(2026, 9, 4, 10, 15, 2, 114));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(
      Date.UTC(2026, 9, 4, 10, 15, 2, 114),
    );
  });

  it("sorts by creation time", () => {
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});

describe("createEnvelope", () => {
  it("builds a valid envelope for the contract", () => {
    const envelope = createEnvelope(systemPingV1, { trigger: "heartbeat" }, "jadero/api");
    expect(systemPingV1.envelope.parse(envelope)).toEqual(envelope);
    expect(envelope).toMatchObject({ source: "jadero/api", type: "dev.jadero.system.ping.v1" });
  });

  it("refuses data its consumers would reject, before anything is written", () => {
    expect(() =>
      createEnvelope(systemPingV1, { trigger: "cron" } as never, "jadero/api"),
    ).toThrow();
  });

  it("leaves traceparent out when nothing is being traced", () => {
    expect(createEnvelope(systemPingV1, { trigger: "manual" }, "jadero/api")).not.toHaveProperty(
      "traceparent",
    );
  });
});

describe("backoffSeconds (relay, per row)", () => {
  it("waits 1, 2, 4 ... seconds, at most 60", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(backoffSeconds)).toEqual([
      1, 2, 4, 8, 16, 32, 60, 60, 60,
    ]);
  });
});
