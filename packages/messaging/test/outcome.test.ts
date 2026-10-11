import { describe, expect, it } from "vitest";
import { attemptOf, DEFAULT_RETRY_TIERS_MS, dead, dispose, done, retry } from "../src/index.js";

describe("dispose (the retry and dead-letter policy)", () => {
  it("acks a done", () => {
    expect(dispose(done(), 1)).toEqual({ action: "ack" });
  });

  it("waits 10 s, 1 min, then 10 min before the 2nd, 3rd and 4th attempt", () => {
    expect([1, 2, 3].map((attempt) => dispose(retry("x"), attempt))).toEqual([
      { action: "retry", delayMs: 10_000, nextAttempt: 2 },
      { action: "retry", delayMs: 60_000, nextAttempt: 3 },
      { action: "retry", delayMs: 600_000, nextAttempt: 4 },
    ]);
    expect(DEFAULT_RETRY_TIERS_MS).toEqual([10_000, 60_000, 600_000]);
  });

  it("dead-letters a retry after the last tier, keeping the reason", () => {
    expect(dispose(retry("db down"), 4)).toEqual({
      action: "dead-letter",
      reason: "retries exhausted after 4 attempts: db down",
    });
  });

  it("dead-letters a dead outcome on any attempt", () => {
    expect(dispose(dead("bad payload"), 1)).toEqual({
      action: "dead-letter",
      reason: "bad payload",
    });
  });
});

describe("attemptOf (the attempt header of a delivery)", () => {
  it("reads the number the adapter writes on a retry copy, also as a string", () => {
    expect([attemptOf(2), attemptOf("3")]).toEqual([2, 3]);
  });

  it("counts a missing header as the first attempt", () => {
    expect([attemptOf(undefined), attemptOf(null)]).toEqual([1, 1]);
  });

  it("counts a malformed header as the first attempt, so a retry keeps its tiers", () => {
    // Before attemptOf, Number("abc") gave NaN and dispose dead-lettered the message at once as
    // "retries exhausted after NaN attempts".
    for (const header of ["abc", 0, -1, 2.5, "", {}]) expect(attemptOf(header)).toBe(1);
    expect(dispose(retry("db down"), attemptOf("abc"))).toEqual({
      action: "retry",
      delayMs: 10_000,
      nextAttempt: 2,
    });
  });
});
