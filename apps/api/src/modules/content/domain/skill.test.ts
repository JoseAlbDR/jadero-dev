import { describe, expect, it } from "vitest";
import { isSkillComplete, Skill, type SkillDocument } from "./skill.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

function doc(over: Partial<SkillDocument> = {}): SkillDocument {
  return { name: "Messaging", category: "backend", projectSlugs: ["sample-project"], ...over };
}

describe("Skill", () => {
  it.each`
    case                    | document                                     | expected
    ${"complete"}           | ${doc()}                                     | ${true}
    ${"no projects"}        | ${doc({ projectSlugs: [] })}                 | ${true}
    ${"no name"}            | ${doc({ name: "" })}                         | ${false}
    ${"no category"}        | ${doc({ category: " " })}                    | ${false}
    ${"a bad project slug"} | ${doc({ projectSlugs: ["Sample Project"] })} | ${false}
  `("is complete: $expected when $case", ({ document, expected }) => {
    expect(isSkillComplete(document)).toBe(expected);
  });

  it("creates, saves, publishes and archives", () => {
    const skill = Skill.create({ id: "s-1", sortOrder: 3 });
    expect(skill).toMatchObject({ id: "s-1", sortOrder: 3, version: 0 });
    skill.saveRevision("es", doc({ category: "mensajería" }), "owner", "r-es", AT);
    skill.saveRevision("en", doc(), "owner", "r-en", AT);
    expect(skill.publish(["es", "en"], AT).warnings).toHaveLength(1);
    skill.archive(AT);
    expect(skill.translations.archivedAt()).toEqual(AT);
  });

  it("reconstitutes with its stored version", () => {
    const skill = Skill.reconstitute({
      id: "s-1",
      sortOrder: 3,
      version: 7,
      translations: { locales: {}, archivedAt: null },
    });
    expect(skill.version).toBe(7);
  });
});
