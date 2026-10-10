import { describe, expect, it } from "vitest";
import { SystemClock } from "./system-clock.js";
import { UuidV7IdGenerator } from "./uuid-v7-id-generator.js";

describe("content system ports", () => {
  it("generates UUIDv7 ids: version nibble 7, RFC 9562 variant, never the same twice", () => {
    const ids = new UuidV7IdGenerator();
    const first = ids.next();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids.next()).not.toBe(first);
  });

  it("reads the system time on every call", () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
