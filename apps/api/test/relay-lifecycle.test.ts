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

  /**
   * Builds the lifecycle over recording fakes.
   * @param heartbeatIntervalMs ping interval; the daily cleanup test passes a long one, so advancing
   *   a day of fake time runs a few callbacks instead of 86,400 (slow enough to time out under load)
   */
  function setup(heartbeatIntervalMs = 1000) {
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
    const config = { heartbeatIntervalMs } as ApiWorkerConfig;
    return { lifecycle: new RelayLifecycle(relay, bus, ping, config), calls };
  }

  it("starts the relay and pings at once and on every interval", async () => {
    const { lifecycle, calls } = setup();
    lifecycle.onApplicationBootstrap();
    expect(calls).toEqual(["relay.start", "ping.heartbeat", "relay.cleanup"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((c) => c === "ping.heartbeat")).toHaveLength(3);
    await lifecycle.beforeApplicationShutdown();
  });

  it("cleans the outbox at boot and once a day", async () => {
    const { lifecycle, calls } = setup(CLEANUP_INTERVAL_MS / 4);
    lifecycle.onApplicationBootstrap();
    expect(calls.filter((c) => c === "relay.cleanup")).toHaveLength(1);
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
