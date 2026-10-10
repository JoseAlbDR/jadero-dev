import { describe, expect, it } from "vitest";
import { invalidEntries, isTag, isUrlWith, isYearMonth } from "./field-formats.js";

describe("field formats", () => {
  it.each`
    value                      | schemes                | expected
    ${"https://example.com/a"} | ${["https"]}           | ${true}
    ${"http://example.com"}    | ${["https"]}           | ${false}
    ${"mailto:a@example.com"}  | ${["https", "mailto"]} | ${true}
    ${"mailto:a@example.com"}  | ${["https"]}           | ${false}
    ${"javascript:alert(1)"}   | ${["https", "mailto"]} | ${false}
    ${"example.com"}           | ${["https"]}           | ${false}
  `("isUrlWith($value, $schemes) is $expected", ({ value, schemes, expected }) => {
    expect(isUrlWith(value, schemes)).toBe(expected);
  });

  it.each([
    ["2025-01", true],
    ["2025-12", true],
    ["2025-00", false],
    ["2025-1", false],
    ["", false],
  ])("isYearMonth(%j) is %s", (value, expected) => {
    expect(isYearMonth(value)).toBe(expected);
  });

  it("checks tags and names the bad entries", () => {
    expect([isTag(""), isTag("x"), isTag("x".repeat(60)), isTag("x".repeat(61))]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(invalidEntries("tags", ["ok", "", "fine", ""], isTag)).toEqual(["tags[1]", "tags[3]"]);
  });
});
