import {
  experienceItemDto,
  postDto,
  profileDto,
  projectDto,
  skillDto,
  slug,
  tags,
  yearMonth,
} from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  type ExperienceItemDocument,
  experienceItemRules,
} from "../src/modules/content/domain/experience-item.js";
import {
  isSlug,
  isTag,
  isUrlWith,
  isYearMonth,
} from "../src/modules/content/domain/field-formats.js";
import type { DocumentRules } from "../src/modules/content/domain/localized-revisions.js";
import { type PostDocument, postRules } from "../src/modules/content/domain/post.js";
import { type ProfileDocument, profileRules } from "../src/modules/content/domain/profile.js";
import { type ProjectDocument, projectRules } from "../src/modules/content/domain/project.js";
import { type SkillDocument, skillRules } from "../src/modules/content/domain/skill.js";

/**
 * The domain may not import the contracts (rule domain-imports-only-domain), so it keeps its own
 * copy of the publish rules. This file is where the two meet: a document the domain calls complete
 * must parse as the public DTO, and the fields the domain requires must be exactly the ones the DTO
 * requires, plus the body each type requires on purpose (a page with no body is not a page).
 */
interface Case<TDoc extends object> {
  readonly type: string;
  readonly rules: DocumentRules<TDoc>;
  readonly dto: z.ZodType;
  /** The DTO a published revision becomes, with placeholder root and read-side fields. */
  readonly toDto: (doc: TDoc) => unknown;
  /** Only what completeness needs; every optional field empty. */
  readonly minimal: TDoc;
  /** Each text field emptied, by name. */
  readonly blank: Record<string, (doc: TDoc) => TDoc>;
  /** Fields the domain requires although the DTO accepts them empty. */
  readonly requiredOnPurpose: readonly string[];
}

function suite<TDoc extends object>(c: Case<TDoc>): void {
  describe(`${c.type} documents against the public contract`, () => {
    it("a minimal complete document parses as the DTO", () => {
      expect(c.rules.isComplete(c.minimal)).toBe(true);
      expect(c.rules.invalidFields(c.minimal)).toEqual([]);
      expect(c.dto.safeParse(c.toDto(c.minimal)).success).toBe(true);
    });

    it("requires exactly the fields the DTO requires, plus the body on purpose", () => {
      const domainRequires = Object.keys(c.blank).filter(
        (field) => !c.rules.isComplete(c.blank[field]?.(c.minimal) as TDoc),
      );
      const dtoRequires = Object.keys(c.blank).filter(
        (field) => !c.dto.safeParse(c.toDto(c.blank[field]?.(c.minimal) as TDoc)).success,
      );
      expect(domainRequires.sort()).toEqual([...dtoRequires, ...c.requiredOnPurpose].sort());
    });
  });
}

suite<ProjectDocument>({
  type: "Project",
  rules: projectRules,
  dto: projectDto,
  toDto: (doc) => ({ ...doc, locale: "en", kind: "project", featured: false, alternates: {} }),
  minimal: {
    slug: "sample-project",
    title: "Sample",
    summary: "",
    body: "Body.",
    stackTags: [],
    repoUrl: null,
    demoUrl: null,
  },
  blank: {
    slug: (d) => ({ ...d, slug: "" }),
    title: (d) => ({ ...d, title: "" }),
    summary: (d) => ({ ...d, summary: "" }),
    body: (d) => ({ ...d, body: "" }),
  },
  requiredOnPurpose: ["body"],
});

suite<PostDocument>({
  type: "Post",
  rules: postRules,
  dto: postDto,
  toDto: (doc) => ({
    ...doc,
    locale: "en",
    publishedAt: "2026-11-03T10:12:00.000Z",
    alternates: {},
  }),
  minimal: { slug: "sample-post", title: "Sample", excerpt: "", body: "Body.", tags: [] },
  blank: {
    slug: (d) => ({ ...d, slug: "" }),
    title: (d) => ({ ...d, title: "" }),
    excerpt: (d) => ({ ...d, excerpt: "" }),
    body: (d) => ({ ...d, body: "" }),
  },
  requiredOnPurpose: ["body"],
});

suite<ProfileDocument>({
  type: "Profile",
  rules: profileRules,
  dto: profileDto,
  toDto: (doc) => ({ ...doc, locale: "en" }),
  minimal: { name: "Sample Person", headline: "Engineer", summary: "Summary.", links: [] },
  blank: {
    name: (d) => ({ ...d, name: "" }),
    headline: (d) => ({ ...d, headline: "" }),
    summary: (d) => ({ ...d, summary: "" }),
  },
  requiredOnPurpose: ["summary"],
});

suite<ExperienceItemDocument>({
  type: "ExperienceItem",
  rules: experienceItemRules,
  dto: experienceItemDto,
  toDto: (doc) => ({ ...doc, locale: "en", bullets: [] }),
  minimal: {
    organization: "Sample Company",
    role: "Engineer",
    period: { from: "2024-03", to: null },
    locationType: "remote",
    stackTags: [],
  },
  blank: {
    organization: (d) => ({ ...d, organization: "" }),
    role: (d) => ({ ...d, role: "" }),
    "period.from": (d) => ({ ...d, period: { ...d.period, from: "" } }),
  },
  requiredOnPurpose: [],
});

suite<SkillDocument>({
  type: "Skill",
  rules: skillRules,
  dto: skillDto,
  toDto: (doc) => ({ ...doc, locale: "en" }),
  minimal: { name: "Messaging", category: "backend", projectSlugs: [] },
  blank: {
    name: (d) => ({ ...d, name: "" }),
    category: (d) => ({ ...d, category: "" }),
  },
  requiredOnPurpose: [],
});

describe("domain field formats agree with the contract", () => {
  it.each(["portal-de-empleo", "a1", "", "Upper", "two--hyphens", "-lead", "a_b", "a".repeat(121)])(
    "slug %j",
    (value) => {
      expect(isSlug(value)).toBe(slug.safeParse(value).success);
    },
  );

  it.each(["2025-03", "2025-13", "2025-3", "25-03", ""])("year and month %j", (value) => {
    expect(isYearMonth(value)).toBe(yearMonth.safeParse(value).success);
  });

  it.each(["", "x", "x".repeat(60), "x".repeat(61)])("tag %j", (value) => {
    expect(isTag(value)).toBe(tags.safeParse([value]).success);
  });

  it.each(["https://example.com/a", "http://example.com", "javascript:alert(1)", "example.com"])(
    "HTTPS URL %j",
    (value) => {
      const contract = projectDto.shape.repoUrl.safeParse(value).success;
      expect(isUrlWith(value, ["https"])).toBe(contract);
    },
  );
});
