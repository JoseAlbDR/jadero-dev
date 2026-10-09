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
 * must parse as the public DTO, and the fields the domain requires at publish must be exactly the
 * ones the DTO refuses when blank: the contract is never weaker than the domain, nor stricter.
 */
interface Case<TDoc extends object> {
  readonly type: string;
  readonly rules: DocumentRules<TDoc>;
  readonly dto: z.ZodType;
  /** The DTO a published revision becomes, with placeholder root and read-side fields. */
  readonly toDto: (doc: TDoc) => unknown;
  /** Only what completeness needs; every optional field empty. */
  readonly minimal: TDoc;
  /** Each text field set to a given value, by name. */
  readonly blank: Record<string, (doc: TDoc, value: string) => TDoc>;
}

function suite<TDoc extends object>(c: Case<TDoc>): void {
  describe(`${c.type} documents against the public contract`, () => {
    it("a minimal complete document parses as the DTO", () => {
      expect(c.rules.isComplete(c.minimal)).toBe(true);
      expect(c.rules.invalidFields(c.minimal)).toEqual([]);
      expect(c.dto.safeParse(c.toDto(c.minimal)).success).toBe(true);
    });

    it.each(["", " \n"])("requires the same fields as the DTO when a field is %j", (value) => {
      const fields = Object.keys(c.blank);
      const variant = (field: string) => c.blank[field]?.(c.minimal, value) as TDoc;
      const domainRequires = fields.filter((field) => !c.rules.isComplete(variant(field)));
      const dtoRequires = fields.filter(
        (field) => !c.dto.safeParse(c.toDto(variant(field))).success,
      );
      expect(domainRequires.length).toBeGreaterThan(0);
      expect(dtoRequires).toEqual(domainRequires);
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
    slug: (d, v) => ({ ...d, slug: v }),
    title: (d, v) => ({ ...d, title: v }),
    summary: (d, v) => ({ ...d, summary: v }),
    body: (d, v) => ({ ...d, body: v }),
  },
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
    slug: (d, v) => ({ ...d, slug: v }),
    title: (d, v) => ({ ...d, title: v }),
    excerpt: (d, v) => ({ ...d, excerpt: v }),
    body: (d, v) => ({ ...d, body: v }),
  },
});

suite<ProfileDocument>({
  type: "Profile",
  rules: profileRules,
  dto: profileDto,
  toDto: (doc) => ({ ...doc, locale: "en" }),
  minimal: { name: "Sample Person", headline: "Engineer", summary: "Summary.", links: [] },
  blank: {
    name: (d, v) => ({ ...d, name: v }),
    headline: (d, v) => ({ ...d, headline: v }),
    summary: (d, v) => ({ ...d, summary: v }),
  },
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
    organization: (d, v) => ({ ...d, organization: v }),
    role: (d, v) => ({ ...d, role: v }),
    "period.from": (d, v) => ({ ...d, period: { ...d.period, from: v } }),
  },
});

suite<SkillDocument>({
  type: "Skill",
  rules: skillRules,
  dto: skillDto,
  toDto: (doc) => ({ ...doc, locale: "en" }),
  minimal: { name: "Messaging", category: "backend", projectSlugs: [] },
  blank: {
    name: (d, v) => ({ ...d, name: v }),
    category: (d, v) => ({ ...d, category: v }),
  },
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
