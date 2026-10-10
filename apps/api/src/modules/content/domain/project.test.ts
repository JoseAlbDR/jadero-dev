import { describe, expect, it } from "vitest";
import { FieldFormatInvalid, InvalidTransition, SlugInvalid } from "./content.errors.js";
import { Project, type ProjectDocument, projectRules } from "./project.js";

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
    repoUrl: "https://example.com/sample",
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
    field        | value   | complete
    ${"slug"}    | ${""}   | ${false}
    ${"title"}   | ${" "}  | ${false}
    ${"body"}    | ${"\n"} | ${false}
    ${"summary"} | ${""}   | ${true}
    ${"repoUrl"} | ${null} | ${true}
  `("is complete: $complete with $field = $value", ({ field, value, complete }) => {
    expect(projectRules.isComplete(doc())).toBe(true);
    expect(projectRules.isComplete(doc({ [field]: value }))).toBe(complete);
  });

  it.each`
    over                                  | fields
    ${{ slug: "Not A Slug" }}             | ${["slug"]}
    ${{ stackTags: ["ok", ""] }}          | ${["stackTags[1]"]}
    ${{ repoUrl: "http://example.com" }}  | ${["repoUrl"]}
    ${{ demoUrl: "javascript:alert(1)" }} | ${["demoUrl"]}
    ${{ repoUrl: "" }}                    | ${["repoUrl"]}
  `("refuses to save $over", ({ over, fields }) => {
    expect(projectRules.invalidFields(doc(over))).toEqual(fields);
    const project = Project.create(LAYOUT);
    expect(() => project.saveRevision("es", doc(over), "owner", "r-es", AT)).toThrow(
      FieldFormatInvalid,
    );
  });

  it("saves an incomplete draft whose filled fields are well formed", () => {
    const project = Project.create(LAYOUT);
    const draft = doc({ slug: "", title: "", body: "", repoUrl: null });
    expect(projectRules.invalidFields(draft)).toEqual([]);
    project.saveRevision("es", draft, "owner", "r-es", AT);
    expect(project.translations.isComplete("es")).toBe(false);
  });

  it("saves, publishes es and en with a de warning, then archives", () => {
    const project = Project.create(LAYOUT);
    project.saveRevision("es", doc({ slug: "proyecto-ejemplo" }), "owner", "r-es", AT);
    const en = project.saveRevision("en", doc(), "machine", "r-en", AT);
    expect(en).toMatchObject({ itemId: "p-1", locale: "en", number: 1, origin: "machine" });

    const result = project.publish(["es", "en"], AT);
    expect(result.warnings).toEqual([{ code: "optional-locale-unpublished", locale: "de" }]);
    expect(project.translations.stateOf("en")).toBe("published");
    expect(project.translations.firstPublishedAt("en")).toEqual(AT);

    project.archive(AT);
    expect(project.translations.archivedAt()).toEqual(AT);
    expect(project.translations.published("en")?.id).toBe("r-en");
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
