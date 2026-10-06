import { afterEach, describe, expect, it, vi } from "vitest";
import { RandomIdGenerator } from "./random-id-generator.js";

describe("RandomIdGenerator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates UUIDv7: version nibble 7, RFC 9562 variant", () => {
    const id = new RandomIdGenerator().next();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts ids in creation order when they are created in different milliseconds", () => {
    // Only the first 48 bits are time; inside one millisecond the rest is random, so the clock is
    // moved by one millisecond between the two calls.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T10:00:00.000Z"));
    const generator = new RandomIdGenerator();
    const first = generator.next();
    vi.setSystemTime(new Date("2026-10-06T10:00:00.001Z"));
    const second = generator.next();
    expect([second, first].sort()).toEqual([first, second]);
    // The first 12 hex digits are the creation time in milliseconds.
    const millis = Date.parse("2026-10-06T10:00:00.000Z").toString(16).padStart(12, "0");
    expect(first.replace("-", "").slice(0, 12)).toBe(millis);
  });
});
