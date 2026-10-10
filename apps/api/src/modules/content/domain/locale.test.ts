import { describe, expect, it } from "vitest";
import { isLocale, LOCALES, OPTIONAL_LOCALES, REQUIRED_LOCALES } from "./locale.js";

describe("Locale", () => {
  it("requires es and en and leaves de optional (D-20)", () => {
    expect(LOCALES).toEqual(["es", "en", "de"]);
    expect(REQUIRED_LOCALES).toEqual(["es", "en"]);
    expect(OPTIONAL_LOCALES).toEqual(["de"]);
  });

  it.each`
    value   | expected
    ${"es"} | ${true}
    ${"en"} | ${true}
    ${"de"} | ${true}
    ${"fr"} | ${false}
    ${"ES"} | ${false}
    ${""}   | ${false}
  `("isLocale($value) is $expected", ({ value, expected }) => {
    expect(isLocale(value)).toBe(expected);
  });
});
