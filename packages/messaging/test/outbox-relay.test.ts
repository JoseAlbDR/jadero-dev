import type { CloudEventEnvelope } from "@jadero/contracts";
import { context, propagation } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { isTracingSuppressed, W3CTraceContextPropagator } from "@opentelemetry/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  currentTraceparent,
  InMemoryMessageBus,
  type MessageBus,
  OutboxRelay,
  type OutgoingMessage,
  type SqlClient,
  type SqlPool,
} from "../src/index.js";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function row(n: number, traceparent?: string) {
  const envelope: CloudEventEnvelope = {
    specversion: "1.0",
    id: `0199b1c4-7e2a-7c3d-9f10-${String(n).padStart(12, "0")}`,
    source: "jadero/api",
    type: "dev.jadero.system.ping.v1",
    time: "2026-10-04T10:15:02.114Z",
    datacontenttype: "application/json",
    ...(traceparent ? { traceparent } : {}),
    data: { trigger: "manual" },
  };
  return { id: envelope.id, routing_key: "system.ping.v1", envelope, attempts: 0 };
}

/** A pool whose claim query returns the given rows once, and that records every statement. */
function fakePool(rows: ReturnType<typeof row>[]) {
  const statements: string[] = [];
  const suppressed: boolean[] = [];
  let claimed = false;
  const client: SqlClient = {
    async query<R>(text: string) {
      statements.push(text.trim().split(/\s+/)[0] ?? "");
      suppressed.push(isTracingSuppressed(context.active()));
      if (text.includes("FOR UPDATE SKIP LOCKED") && !claimed) {
        claimed = true;
        return { rows: rows as unknown as R[], rowCount: rows.length };
      }
      return { rows: [] as R[], rowCount: 0 };
    },
    release() {},
  };
  const pool: SqlPool = { connect: async () => client };
  return { pool, statements, suppressed };
}

class SpyBus extends InMemoryMessageBus {
  readonly sent: {
    message: OutgoingMessage;
    traceparent: string | undefined;
    suppressed: boolean;
  }[] = [];
  constructor(private readonly behavior: (n: number) => Promise<void> = async () => {}) {
    super();
  }
  override async publish(message: OutgoingMessage): Promise<void> {
    this.sent.push({
      message,
      traceparent: currentTraceparent(),
      suppressed: isTracingSuppressed(context.active()),
    });
    await this.behavior(this.sent.length);
  }
}

describe("OutboxRelay", () => {
  const contextManager = new AsyncLocalStorageContextManager();
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });
  afterAll(() => {
    context.disable();
    propagation.disable();
  });

  it("publishes each row inside the trace context stored in its envelope (ADR-010, E1)", async () => {
    const { pool } = fakePool([row(1, TRACEPARENT), row(2)]);
    const bus = new SpyBus();
    await new OutboxRelay({ pool, bus: bus as MessageBus }).runOnce();
    // What the amqplib instrumentation would inject into the headers: the request's trace.
    expect(bus.sent[0]?.traceparent).toBe(TRACEPARENT);
    expect(bus.sent[1]?.traceparent).toBeUndefined();
  });

  it("does not trace its own poll queries, only the publishes (no span flood every second)", async () => {
    const { pool, suppressed } = fakePool([row(1, TRACEPARENT)]);
    const bus = new SpyBus();
    await new OutboxRelay({ pool, bus: bus as MessageBus }).runOnce();
    expect(suppressed.every(Boolean)).toBe(true);
    expect(bus.sent[0]?.suppressed).toBe(false);
  });

  it("ends the batch at the first failed publish instead of waiting a timeout per row", async () => {
    const { pool, statements } = fakePool([row(1), row(2), row(3)]);
    const bus = new SpyBus(async () => {
      throw new Error("Timeout");
    });
    expect(await new OutboxRelay({ pool, bus: bus as MessageBus }).runOnce()).toEqual({
      published: 0,
      failed: 1,
    });
    expect(bus.sent).toHaveLength(1);
    expect(statements).toEqual(["BEGIN", "SELECT", "UPDATE", "COMMIT"]);
  });

  it("on stop, finishes the row in flight and leaves the rest of the batch", async () => {
    const { pool } = fakePool([row(1), row(2), row(3)]);
    let stopped: Promise<void> | undefined;
    let relay: OutboxRelay | undefined;
    const bus = new SpyBus(async (n) => {
      // SIGTERM arrives while the first row is being published.
      if (n === 1) stopped = relay?.stop();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    relay = new OutboxRelay({ pool, bus: bus as MessageBus, intervalMs: 10 });
    relay.start();
    await vi.waitFor(() => expect(stopped).toBeDefined());
    await stopped;
    expect(bus.sent).toHaveLength(1);
  });

  it("does not poll again after stop", async () => {
    const { pool, statements } = fakePool([]);
    const relay = new OutboxRelay({ pool, bus: new SpyBus() as MessageBus, intervalMs: 5 });
    relay.start();
    await relay.stop();
    const polls = statements.filter((s) => s === "SELECT").length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(statements.filter((s) => s === "SELECT").length).toBe(polls);
  });
});
