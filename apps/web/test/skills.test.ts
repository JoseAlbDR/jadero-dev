import type { SkillDto } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { groupSkills } from "../src/content/skills";

/** A skill with no projects. */
function skill(name: string, category: string, locale: SkillDto["locale"] = "de"): SkillDto {
  return { locale, name, category, projectSlugs: [] };
}

describe("groupSkills", () => {
  it("groups by category in the order the API first lists each one, keeping skill order", () => {
    const groups = groupSkills(
      [
        skill("NestJS", "Backend"),
        skill("Vitest", "Tests"),
        skill("PostgreSQL", "Backend"),
        skill("Playwright", "Tests"),
      ],
      "de",
    );

    expect(groups.map((g) => [g.category, g.skills.map((s) => s.name)])).toEqual([
      ["Backend", ["NestJS", "PostgreSQL"]],
      ["Tests", ["Vitest", "Playwright"]],
    ]);
  });

  it("marks a category that only English fallback skills carry with lang en", () => {
    const groups = groupSkills(
      [skill("NestJS", "Backend"), skill("Testcontainers", "Testing", "en")],
      "de",
    );

    expect(groups.map((g) => [g.category, g.lang])).toEqual([
      ["Backend", undefined],
      ["Testing", "en"],
    ]);
  });

  it("keeps a category name that reads the same in both languages in the page's language", () => {
    const groups = groupSkills(
      [skill("RabbitMQ", "Backend", "en"), skill("NestJS", "Backend", "de")],
      "de",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.lang).toBeUndefined();
  });

  it("returns no groups for no skills", () => {
    expect(groupSkills([], "en")).toEqual([]);
  });
});
