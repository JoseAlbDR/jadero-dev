import {
  cvBulletDto,
  cvBulletId,
  experienceItemDto,
  knowledgeEntryDto,
  knowledgeEntryId,
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
import { type CvBulletDocument, cvBulletRules } from "../src/modules/content/domain/cv-bullet.js";
import {
  type ExperienceItemDocument,
  experienceItemRules,
} from "../src/modules/content/domain/experience-item.js";
import {
  isCvBulletId,
  isKnowledgeEntryId,
  isSlug,
  isTag,
  isUrlWith,
  isYearMonth,
} from "../src/modules/content/domain/field-formats.js";
import {
  type KnowledgeEntryDocument,
  type KnowledgeEntrySectionKey,
  knowledgeEntryRules,
} from "../src/modules/content/domain/knowledge-entry.js";
import type { DocumentRules } from "../src/modules/content/domain/localized-revisions.js";
import { type PostDocument, postRules } from "../src/modules/content/domain/post.js";
import { type ProfileDocument, profileRules } from "../src/modules/content/domain/profile.js";
import { type ProjectDocument, projectRules } from "../src/modules/content/domain/project.js";
import { type SkillDocument, skillRules } from "../src/modules/content/domain/skill.js";

/**
 * The domain may not import the contracts (rule domain-imports-only-domain), so it keeps its own
 * copy of the publish rules. This file is where the two meet: a document the domain calls complete
 * must parse as the public DTO, and the fields the domain requires at publish must be exactly the
 * ones the DTO refuses when blank: the contract is never weaker than the domain, nor stricter. For
 * knowledge entries "publish" is approval, and the private fields (D-67) live in the revision's
 * provenance, outside the document: in no DTO and in no completeness rule.
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

suite<CvBulletDocument>({
  type: "CvBullet",
  rules: cvBulletRules,
  dto: cvBulletDto,
  toDto: (doc) => ({ ...doc, id: "backend-10", entryIds: [] }),
  minimal: { text: "Built the outbox relay." },
  blank: {
    text: (d, v) => ({ ...d, text: v }),
  },
});

/** Sets the body of one section of a document. */
function withSection(
  doc: KnowledgeEntryDocument,
  key: KnowledgeEntrySectionKey,
  body: string,
): KnowledgeEntryDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.key === key ? { key, body } : s)) };
}

const minimalEntry: KnowledgeEntryDocument = {
  title: "Sample entry",
  type: "feature",
  domain: "messaging",
  period: { from: "2025-03", to: null },
  role: "lead",
  sections: [
    { key: "summary", body: "Summary." },
    { key: "problem", body: "Problem." },
    { key: "whatHeBuilt", body: "What he built." },
    { key: "lessons", body: "Lessons." },
  ],
  questions: ["What was built?"],
  stack: [],
  patterns: [],
  related: [],
  cvBullet: null,
  indexable: true,
};

const entryToDto = (doc: KnowledgeEntryDocument) => ({ ...doc, id: "kb-sample-entry" });

suite<KnowledgeEntryDocument>({
  type: "KnowledgeEntry",
  rules: knowledgeEntryRules,
  dto: knowledgeEntryDto,
  toDto: entryToDto,
  minimal: minimalEntry,
  blank: {
    title: (d, v) => ({ ...d, title: v }),
    domain: (d, v) => ({ ...d, domain: v }),
    "period.from": (d, v) => ({ ...d, period: { ...d.period, from: v } }),
    "sections.summary": (d, v) => withSection(d, "summary", v),
    "sections.problem": (d, v) => withSection(d, "problem", v),
    "sections.whatHeBuilt": (d, v) => withSection(d, "whatHeBuilt", v),
    "sections.lessons": (d, v) => withSection(d, "lessons", v),
    "questions[0]": (d, v) => ({ ...d, questions: [v] }),
  },
});

describe("KnowledgeEntry documents against the public contract, beyond blank fields", () => {
  it.each`
    case                       | doc
    ${"no Summary section"}    | ${{ ...minimalEntry, sections: minimalEntry.sections.slice(1) }}
    ${"sections out of order"} | ${{ ...minimalEntry, sections: [...minimalEntry.sections].reverse() }}
    ${"no question"}           | ${{ ...minimalEntry, questions: [] }}
  `("the domain and the DTO both refuse $case", ({ doc }) => {
    expect(knowledgeEntryRules.isComplete(doc)).toBe(false);
    expect(knowledgeEntryDto.safeParse(entryToDto(doc)).success).toBe(false);
  });
});

/**
 * Every key of the entry document, listed once. `satisfies` makes the compiler refuse a missing or
 * an extra key, so this list is the document type's shape, checked at run time below.
 */
const ENTRY_DOCUMENT_KEYS = Object.keys({
  title: true,
  type: true,
  domain: true,
  period: true,
  role: true,
  sections: true,
  questions: true,
  stack: true,
  patterns: true,
  related: true,
  cvBullet: true,
  indexable: true,
} satisfies Record<keyof KnowledgeEntryDocument, true>);

/** The private fields of the format (D-67), which belong to the provenance, never the document. */
const PRIVATE_ENTRY_KEYS = ["sources", "conflicts", "publicNames", "confidence"];

/** Public document keys the DTO does not carry (none today); each must be named here on purpose. */
const PUBLIC_KEYS_OUTSIDE_THE_DTO: readonly string[] = [];

/** Every field filled, every optional section present, so a parse that drops anything shows it. */
const fullEntry: KnowledgeEntryDocument = {
  title: "Sample entry",
  type: "integration",
  domain: "messaging",
  period: { from: "2025-03", to: "2025-06" },
  role: "sole author",
  sections: [
    { key: "summary", body: "Summary." },
    { key: "problem", body: "Problem." },
    { key: "whatHeBuilt", body: "What he built." },
    { key: "howItWorks", body: "How it works." },
    { key: "tradeoffs", body: "Tradeoffs." },
    { key: "testingRollout", body: "Testing and rollout." },
    { key: "outcome", body: "Outcome." },
    { key: "lessons", body: "Lessons." },
  ],
  questions: ["What was built?", "Why this way?"],
  stack: ["NestJS"],
  patterns: ["outbox"],
  related: ["kb-other-entry"],
  cvBullet: "backend-10",
  indexable: false,
};

describe("the KnowledgeEntry document holds only public fields (D-67, defense in depth)", () => {
  it("every document key is a DTO key or a named public key outside it, and none is private", () => {
    const dtoKeys = Object.keys(knowledgeEntryDto.shape);
    for (const key of ENTRY_DOCUMENT_KEYS) {
      expect(PRIVATE_ENTRY_KEYS).not.toContain(key);
      expect([...dtoKeys, ...PUBLIC_KEYS_OUTSIDE_THE_DTO]).toContain(key);
    }
  });

  it("a fully filled document parsed as the DTO loses nothing", () => {
    expect(Object.keys(fullEntry).sort()).toEqual([...ENTRY_DOCUMENT_KEYS].sort());
    expect(knowledgeEntryRules.isComplete(fullEntry)).toBe(true);
    expect(knowledgeEntryRules.invalidFields(fullEntry)).toEqual([]);
    expect(knowledgeEntryDto.parse(entryToDto(fullEntry))).toEqual(entryToDto(fullEntry));
  });
});

describe("domain field formats agree with the contract", () => {
  it.each(["portal-de-empleo", "a1", "", "Upper", "two--hyphens", "-lead", "a_b", "a".repeat(121)])(
    "slug %j",
    (value) => {
      expect(isSlug(value)).toBe(slug.safeParse(value).success);
    },
  );

  it.each([
    "backend-10",
    "a",
    "",
    "Backend-10",
    "backend_10",
    "a--b",
    "a".repeat(80),
    "a".repeat(81),
  ])("CV bullet id %j", (value) => {
    expect(isCvBulletId(value)).toBe(cvBulletId.safeParse(value).success);
  });

  it.each([
    "kb-outbox-relay",
    "kb-a",
    "kb-",
    "outbox",
    "kb-Outbox",
    "kb--a",
    `kb-${"a".repeat(117)}`,
    `kb-${"a".repeat(118)}`,
  ])("knowledge entry id %j", (value) => {
    expect(isKnowledgeEntryId(value)).toBe(knowledgeEntryId.safeParse(value).success);
  });

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
