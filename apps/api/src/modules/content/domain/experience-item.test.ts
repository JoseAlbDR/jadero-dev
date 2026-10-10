import { describe, expect, it } from "vitest";
import { FieldFormatInvalid } from "./content.errors.js";
import {
  ExperienceItem,
  type ExperienceItemDocument,
  experienceItemRules,
} from "./experience-item.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

function doc(over: Partial<ExperienceItemDocument> = {}): ExperienceItemDocument {
  return {
    organization: "Sample Company",
    role: "Backend engineer",
    period: { from: "2024-03", to: null },
    locationType: "remote",
    stackTags: ["NestJS"],
    ...over,
  };
}

describe("ExperienceItem", () => {
  it.each`
    case                  | document                                               | expected
    ${"ongoing"}          | ${doc()}                                               | ${true}
    ${"closed"}           | ${doc({ period: { from: "2024-03", to: "2025-01" } })} | ${true}
    ${"one month"}        | ${doc({ period: { from: "2024-03", to: "2024-03" } })} | ${true}
    ${"no organization"}  | ${doc({ organization: " " })}                          | ${false}
    ${"no role"}          | ${doc({ role: "" })}                                   | ${false}
    ${"no start"}         | ${doc({ period: { from: "", to: null } })}             | ${false}
    ${"bad end"}          | ${doc({ period: { from: "2024-03", to: "2025" } })}    | ${false}
    ${"end before start"} | ${doc({ period: { from: "2024-03", to: "2023-12" } })} | ${false}
  `("is complete: $expected when $case", ({ document, expected }) => {
    expect(experienceItemRules.isComplete(document)).toBe(expected);
  });

  it.each`
    period                                | stackTags | fields
    ${{ from: "", to: null }}             | ${[]}     | ${[]}
    ${{ from: "2024-13", to: null }}      | ${[]}     | ${["period.from"]}
    ${{ from: "2024-03", to: "2025" }}    | ${[]}     | ${["period.to"]}
    ${{ from: "2024-03", to: "2023-12" }} | ${[]}     | ${["period.to"]}
    ${{ from: "", to: "2023-12" }}        | ${[""]}   | ${["stackTags[0]"]}
  `("checks the format of $period and $stackTags on save", ({ period, stackTags, fields }) => {
    const document = doc({ period, stackTags });
    expect(experienceItemRules.invalidFields(document)).toEqual(fields);
    const item = ExperienceItem.create({ id: "e-1", sortOrder: 1 });
    if (fields.length > 0) {
      expect(() => item.saveRevision("es", document, "owner", "r", AT)).toThrow(FieldFormatInvalid);
    } else {
      expect(item.saveRevision("es", document, "owner", "r", AT).number).toBe(1);
    }
  });

  it("creates, saves, publishes and archives", () => {
    const item = ExperienceItem.create({ id: "e-1", sortOrder: 1 });
    expect(item).toMatchObject({ id: "e-1", sortOrder: 1, version: 0 });
    item.saveRevision("es", doc(), "owner", "r-es", AT);
    item.saveRevision("en", doc(), "owner", "r-en", AT);
    item.publish(["es", "en"], AT);
    expect(item.translations.stateOf("es")).toBe("published");
    item.archive(AT);
    expect(item.translations.archivedAt()).toEqual(AT);
  });

  it("reconstitutes with its stored version", () => {
    const item = ExperienceItem.reconstitute({
      id: "e-1",
      sortOrder: 4,
      version: 2,
      translations: { locales: {}, archivedAt: null },
    });
    expect(item).toMatchObject({ sortOrder: 4, version: 2 });
  });
});
