import type { MessageBus, OutboxRelay } from "@jadero/messaging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiWorkerConfig } from "../src/config/api-config.js";
import type { PingService } from "../src/modules/ping/index.js";
import { CLEANUP_INTERVAL_MS, RelayLifecycle } from "../src/modules/relay/index.js";

describe("RelayLifecycle (api-worker's background work)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const calls: string[] = [];
    const relay = {
      start: () => calls.push("relay.start"),
      stop: async () => {
        calls.push("relay.stop");
      },
      cleanup: async () => {
        calls.push("relay.cleanup");
        return 0;
      },
    } as unknown as OutboxRelay;
    const bus = { close: async () => calls.push("bus.close") } as unknown as MessageBus;
    const ping = {
      send: async (trigger: string) => {
        calls.push(`ping.${trigger}`);
        return "id";
      },
    } as unknown as PingService;
    const config = { heartbeatIntervalMs: 1000 } as ApiWorkerConfig;
    return { lifecycle: new RelayLifecycle(relay, bus, ping, config), calls };
  }

  it("starts the relay, pings at once and on every interval, and cleans the outbox daily", async () => {
    const { lifecycle, calls } = setup();
    lifecycle.onApplicationBootstrap();
    expect(calls).toEqual(["relay.start", "ping.heartbeat", "relay.cleanup"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((c) => c === "ping.heartbeat")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(calls.filter((c) => c === "relay.cleanup")).toHaveLength(2);
    await lifecycle.beforeApplicationShutdown();
  });

  it("on shutdown stops the timers and the relay before closing the broker connection", async () => {
    const { lifecycle, calls } = setup();
    lifecycle.onApplicationBootstrap();
    await lifecycle.beforeApplicationShutdown();
    await lifecycle.onApplicationShutdown();
    const after = calls.length;
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 2);
    expect(calls.length).toBe(after);
    expect(calls.slice(-2)).toEqual(["relay.stop", "bus.close"]);
  });
});
