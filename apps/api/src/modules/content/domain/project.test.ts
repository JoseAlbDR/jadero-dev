import { describe, expect, it } from "vitest";
import { InvalidTransition, SlugInvalid } from "./content.errors.js";
import { isProjectComplete, Project, type ProjectDocument } from "./project.js";

const AT = new Date("2026-11-03T10:12:00.000Z");
const LAYOUT = {
  id: "p-1",
  slug: "sample-project",
  kind: "project",
  featured: true,
  sortOrder: 2,
} as const;

function doc(over: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    slug: "sample-project",
    title: "Sample project",
    summary: "A placeholder summary.",
    body: "## Problem\nPlaceholder.",
    stackTags: ["NestJS"],
    repoUrl: null,
    demoUrl: null,
    ...over,
  };
}

describe("Project", () => {
  it("creates with its layout, version 0 and every locale missing", () => {
    const project = Project.create(LAYOUT);
    expect(project).toMatchObject(LAYOUT);
    expect(project.version).toBe(0);
    expect(project.translations.stateOf("es")).toBe("missing");
  });

  it.each(["", "Sample", "sample_project", "-sample", "a".repeat(121)])(
    "refuses the canonical slug %j",
    (slug) => {
      expect(() => Project.create({ ...LAYOUT, slug })).toThrow(SlugInvalid);
    },
  );

  it.each`
    field        | value
    ${"slug"}    | ${"Not A Slug"}
    ${"title"}   | ${" "}
    ${"summary"} | ${""}
    ${"body"}    | ${"\n"}
  `("is incomplete with $field = $value", ({ field, value }) => {
    expect(isProjectComplete(doc())).toBe(true);
    expect(isProjectComplete(doc({ [field]: value }))).toBe(false);
  });

  it("saves, publishes es and en with a de warning, then archives", () => {
    const project = Project.create(LAYOUT);
    project.saveRevision("es", doc({ slug: "proyecto-ejemplo" }), "owner", "r-es", AT);
    const en = project.saveRevision("en", doc(), "machine", "r-en", AT);
    expect(en).toMatchObject({ itemId: "p-1", locale: "en", number: 1, origin: "machine" });

    const result = project.publish(["es", "en"], AT);
    expect(result.warnings).toEqual([{ code: "optional-locale-unpublished", locale: "de" }]);
    expect(project.translations.stateOf("en")).toBe("published");

    project.archive(AT);
    expect(project.translations.archivedAt()).toEqual(AT);
    expect(() => project.archive(AT)).toThrow(InvalidTransition);
  });

  it("reconstitutes with its stored version and pointers", () => {
    const project = Project.reconstitute({
      ...LAYOUT,
      version: 5,
      translations: { locales: {}, archivedAt: null },
    });
    expect(project.version).toBe(5);
    expect(project.translations.latest("de")).toBeNull();
  });
});
