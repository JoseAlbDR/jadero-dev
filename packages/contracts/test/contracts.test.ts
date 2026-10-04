import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cloudEventEnvelope, defineEvent, eventContracts, systemPingV1 } from "../src/index.js";

function fixture(routingKey: string): Record<string, unknown> {
  const url = new URL(`../fixtures/${routingKey}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

describe("contract fixtures", () => {
  // The consumer-side contract test of ADR-029: every event ships an example, and the example must
  // parse with the schema consumers use. A new contract without a fixture fails here.
  it.each(eventContracts.map((c) => [c.routingKey, c] as const))(
    "%s: the producer's example parses with the contract",
    (routingKey, contract) => {
      expect(() => contract.envelope.parse(fixture(routingKey))).not.toThrow();
    },
  );
});

describe("system.ping.v1", () => {
  const ping = fixture("system.ping.v1");

  it("names its type and routing key from one string", () => {
    expect(systemPingV1.routingKey).toBe("system.ping.v1");
    expect(systemPingV1.type).toBe("dev.jadero.system.ping.v1");
  });

  it("parses the fixture into typed data", () => {
    const envelope = systemPingV1.envelope.parse(ping);
    expect(envelope.data.trigger).toBe("manual");
    expect(envelope.traceparent).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });

  it("rejects an envelope without an id, since the inbox needs it", () => {
    const { id: _id, ...withoutId } = ping;
    expect(systemPingV1.envelope.safeParse(withoutId).success).toBe(false);
  });

  it("rejects an envelope of another event type", () => {
    const other = { ...ping, type: "dev.jadero.content.published.v1" };
    expect(systemPingV1.envelope.safeParse(other).success).toBe(false);
  });

  it("rejects data outside the schema", () => {
    const bad = { ...ping, data: { trigger: "cron" } };
    expect(systemPingV1.envelope.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed traceparent instead of passing it to the tracer", () => {
    const bad = { ...ping, traceparent: "4bf92f3577b34da6" };
    expect(systemPingV1.envelope.safeParse(bad).success).toBe(false);
  });

  it("accepts an envelope from a newer producer: unknown fields are dropped (expand)", () => {
    const newer = { ...ping, partitionkey: "x", data: { trigger: "manual", region: "eu" } };
    const parsed = systemPingV1.envelope.parse(newer);
    expect(parsed).not.toHaveProperty("partitionkey");
    expect(parsed.data).toEqual({ trigger: "manual" });
  });
});

describe("cloudEventEnvelope", () => {
  it("parses any event before its data is checked", () => {
    const envelope = cloudEventEnvelope.parse(fixture("system.ping.v1"));
    expect(envelope.type).toBe("dev.jadero.system.ping.v1");
  });

  it("rejects a source outside jadero/<service>", () => {
    const bad = { ...fixture("system.ping.v1"), source: "https://example.com" };
    expect(cloudEventEnvelope.safeParse(bad).success).toBe(false);
  });
});

describe("defineEvent", () => {
  it.each(["system.ping", "system.v1", "System.Ping.v1", "system.ping.v0", "system..ping.v1"])(
    "refuses the routing key %s",
    (routingKey) => {
      expect(() => defineEvent(routingKey, z.object({}))).toThrow(/<context>\.<event>\.v<N>/);
    },
  );

  it("accepts multi-word events", () => {
    expect(defineEvent("knowledge.entry.approved.v1", z.object({})).type).toBe(
      "dev.jadero.knowledge.entry.approved.v1",
    );
  });
});
