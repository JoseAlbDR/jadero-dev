import { describe, expect, it } from "vitest";
import { LocaleIncomplete, RequiredLocalesMissing } from "./content.errors.js";
import { Now, nowRules } from "./now.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

describe("Now", () => {
  it.each`
    case            | body                         | complete
    ${"a body"}     | ${"Building the /now page."} | ${true}
    ${"no body"}    | ${""}                        | ${false}
    ${"blank body"} | ${" \n"}                     | ${false}
  `("is complete: $complete with $case", ({ body, complete }) => {
    expect(nowRules.isComplete({ body })).toBe(complete);
    expect(nowRules.invalidFields({ body })).toEqual([]);
  });

  it("saves an empty draft but refuses to publish it", () => {
    const now = Now.create("now");
    now.saveRevision("es", { body: "" }, "owner", "r-es", AT);
    now.saveRevision("en", { body: "Text." }, "owner", "r-en", AT);
    expect(() => now.publish(["es", "en"], AT)).toThrow(LocaleIncomplete);
  });

  it("refuses to go public in Spanish alone", () => {
    const now = Now.create("now");
    expect(now.version).toBe(0);
    now.saveRevision("es", { body: "Texto." }, "owner", "r-es", AT);
    expect(() => now.publish(["es"], AT)).toThrow(RequiredLocalesMissing);
  });

  it("publishes es and en, and offers no archive (a singleton with no restore)", () => {
    const now = Now.create("now");
    now.saveRevision("es", { body: "Texto." }, "owner", "r-es", AT);
    now.saveRevision("en", { body: "Text." }, "owner", "r-en", AT);
    expect(now.publish(["es", "en"], AT).published).toHaveLength(2);
    expect(now.translations.published("en")?.document.body).toBe("Text.");
    expect("archive" in now).toBe(false);
    expect(now.translations.archivedAt()).toBeNull();
  });

  it("reconstitutes with its stored version", () => {
    const now = Now.reconstitute({
      id: "now",
      version: 4,
      translations: { locales: {}, archivedAt: null },
    });
    expect(now).toMatchObject({ id: "now", version: 4 });
  });
});
