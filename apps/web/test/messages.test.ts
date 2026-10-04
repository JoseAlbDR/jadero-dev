import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "../src/i18n/routing";

type Messages = { [key: string]: string | Messages };

/** Dotted paths of every leaf in a message tree, sorted. */
function leafKeys(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages)
    .flatMap(([key, value]) =>
      typeof value === "string" ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
    )
    .sort();
}

function load(locale: string): Messages {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, "../messages", `${locale}.json`), "utf8"),
  );
}

// ADR-022: a missing or empty UI string fails CI. English is the reference locale (D-19).
describe("UI messages", () => {
  const reference = leafKeys(load(routing.defaultLocale));

  it.each(routing.locales)("%s has exactly the reference keys", (locale) => {
    expect(leafKeys(load(locale))).toEqual(reference);
  });

  it.each(routing.locales)("%s has no empty strings", (locale) => {
    const messages = load(locale);
    const empty = leafKeys(messages).filter((path) => {
      const value = path
        .split(".")
        .reduce<Messages | string>(
          (node, key) => (node as Messages)[key] as Messages | string,
          messages,
        );
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });
});
