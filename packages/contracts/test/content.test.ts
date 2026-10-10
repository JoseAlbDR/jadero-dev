import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  encodePostCursor,
  experienceListDto,
  knowledgeEntryDto,
  knowledgeEntryListDto,
  knowledgeEntryParams,
  locale,
  localizedSlugParams,
  postDto,
  postListQuery,
  postPageDto,
  profileDto,
  projectDto,
  projectListDto,
  projectListQuery,
  skillListDto,
} from "../src/index.js";

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../fixtures/content/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

describe("content fixtures", () => {
  // Every public response ships an example that parses with the schema `api` serializes through
  // and `web` reads with; a fixture that drifts from its schema fails here.
  const cases: [string, z.ZodType][] = [
    ["profile", profileDto],
    ["experience", experienceListDto],
    ["projects", projectListDto],
    ["project", projectDto],
    ["project.de-fallback", projectDto],
    ["posts", postPageDto],
    ["post", postDto],
    ["skills", skillListDto],
    ["work", knowledgeEntryListDto],
    ["work-entry", knowledgeEntryDto],
  ];

  it.each(cases)("%s parses unchanged", (name, schema) => {
    const example = fixture(name);
    expect(schema.parse(example)).toEqual(example);
  });
});

describe("locale", () => {
  it.each(["es", "en", "de"])("accepts %s", (value) => {
    expect(locale.parse(value)).toBe(value);
  });

  it.each(["fr", "EN", "en-GB", ""])("rejects %j, so /content/fr/... is a 400", (value) => {
    expect(localizedSlugParams.safeParse({ locale: value, slug: "jobs-hub" }).success).toBe(false);
  });
});

describe("parameters", () => {
  it.each(["Jobs-Hub", "jobs_hub", "-jobs", "jobs--hub", "a/b"])("rejects the slug %j", (slug) => {
    expect(localizedSlugParams.safeParse({ locale: "en", slug }).success).toBe(false);
  });

  it("filters projects by kind and refuses an unknown kind", () => {
    expect(projectListQuery.parse({ kind: "case_study" })).toEqual({ kind: "case_study" });
    expect(projectListQuery.parse({})).toEqual({});
    expect(projectListQuery.safeParse({ kind: "draft" }).success).toBe(false);
  });

  it.each(["kb-outbox-relay", "kb-a1"])("accepts the entry id %s", (entryId) => {
    expect(knowledgeEntryParams.parse({ entryId })).toEqual({ entryId });
  });

  it.each(["outbox-relay", "kb-", "kb-Outbox", "kb_outbox", "kbe_01hx", "kb-outbox-"])(
    "rejects the entry id %j",
    (entryId) => {
      expect(knowledgeEntryParams.safeParse({ entryId }).success).toBe(false);
    },
  );
});

describe("post cursor", () => {
  const position = {
    publishedAt: "2026-11-03T10:12:00.000Z",
    id: "01a15889-fa80-7c3a-9d2e-5f6a7b8c9d0e",
  };

  it("round-trips: the cursor a page returns decodes into the same position", () => {
    const cursor = encodePostCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(postListQuery.parse({ cursor })).toEqual({ cursor: position });
  });

  it("decodes the fixture's nextCursor", () => {
    const { nextCursor } = postPageDto.parse(fixture("posts"));
    expect(postListQuery.parse({ cursor: nextCursor })).toEqual({ cursor: position });
  });

  it("allows the first page without a cursor", () => {
    expect(postListQuery.parse({})).toEqual({});
  });

  it.each([
    ["not base64url", "abc+/="],
    ["base64 of non-JSON", btoa("hello").replace(/=+$/, "")],
    ["JSON that is not a pair", encodeUnchecked({ publishedAt: "x" })],
    ["a bad date", encodeUnchecked(["yesterday", position.id])],
    ["a bad id", encodeUnchecked([position.publishedAt, "42"])],
    ["an empty string", ""],
  ])("rejects %s", (_label, cursor) => {
    expect(postListQuery.safeParse({ cursor }).success).toBe(false);
  });
});

function encodeUnchecked(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

describe("unknown keys are stripped (the default of z.object)", () => {
  it("drops the private entry fields, the second guard behind the query (D-67)", () => {
    const leaked = {
      ...fixture("work-entry"),
      sources: ["merged MRs", "spec"],
      confidence: "medium",
      conflicts: "none",
      publicNames: ["Acme Payments"],
      public_names: ["Acme Payments"],
    };
    const parsed = knowledgeEntryDto.parse(leaked);
    for (const key of ["sources", "confidence", "conflicts", "publicNames", "public_names"]) {
      expect(parsed).not.toHaveProperty(key);
    }
    expect(parsed).toEqual(fixture("work-entry"));
  });

  it("drops private fields from the work-log list items too", () => {
    const list = fixture("work") as { items: Record<string, unknown>[] };
    const leaked = { items: list.items.map((item) => ({ ...item, sources: ["spec"] })) };
    expect(knowledgeEntryListDto.parse(leaked).items[0]).not.toHaveProperty("sources");
  });

  it("drops fields a newer api adds that this version does not know", () => {
    const newer = { ...fixture("project"), revisionId: "x", publishedAt: "2026-11-03T10:12:00Z" };
    expect(projectDto.parse(newer)).toEqual(fixture("project"));
  });
});

describe("German fallback", () => {
  it("accepts a German request answered in English: locale en, no de alternate", () => {
    const parsed = projectDto.parse(fixture("project.de-fallback"));
    expect(parsed.locale).toBe("en");
    expect(parsed.alternates).toEqual({ es: "portal-de-empleo", en: "jobs-hub" });
    expect(parsed.alternates.de).toBeUndefined();
  });

  it("lets each experience item carry its own locale", () => {
    const list = fixture("experience") as { items: Record<string, unknown>[] };
    const [english] = list.items;
    const mixed = { items: [{ ...english, locale: "de" }, english] };
    expect(experienceListDto.parse(mixed).items.map((i) => i.locale)).toEqual(["de", "en"]);
  });
});

describe("knowledge entry sections", () => {
  const entry = fixture("work-entry") as { sections: { key: string; body: string }[] };

  it("rejects sections out of the format's order", () => {
    const [summary, problem, ...rest] = entry.sections;
    const swapped = { ...entry, sections: [problem, summary, ...rest] };
    expect(knowledgeEntryDto.safeParse(swapped).success).toBe(false);
  });

  it("rejects a repeated section", () => {
    const [summary, ...rest] = entry.sections;
    const twice = { ...entry, sections: [summary, summary, ...rest] };
    expect(knowledgeEntryDto.safeParse(twice).success).toBe(false);
  });

  it("rejects an entry without a required section", () => {
    const withoutProblem = {
      ...entry,
      sections: entry.sections.filter((s) => s.key !== "problem"),
    };
    const result = knowledgeEntryDto.safeParse(withoutProblem);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Missing required section problem");
  });

  it("accepts an entry with only the required sections", () => {
    const minimal = { ...entry, sections: entry.sections.slice(0, 3) };
    expect(knowledgeEntryDto.safeParse(minimal).success).toBe(true);
  });

  it("rejects an entry with no questions", () => {
    expect(knowledgeEntryDto.safeParse({ ...entry, questions: [] }).success).toBe(false);
  });
});

describe("values a page renders", () => {
  it.each(["javascript:alert(1)", "http://example.com", "ftp://example.com"])(
    "refuses the project link %s",
    (repoUrl) => {
      expect(projectDto.safeParse({ ...fixture("project"), repoUrl }).success).toBe(false);
    },
  );

  it("allows mailto only on profile links", () => {
    const profile = fixture("profile");
    const script = { ...profile, links: [{ kind: "website", url: "javascript:alert(1)" }] };
    expect(profileDto.safeParse(script).success).toBe(false);
    expect(projectDto.safeParse({ ...fixture("project"), demoUrl: "mailto:a@b.co" }).success).toBe(
      false,
    );
  });

  it.each([
    [{ from: "2025-05", to: "2025-03" }, "ends before it starts"],
    [{ from: "2025-13", to: null }, "month 13"],
    [{ from: "2025-3", to: null }, "no zero padding"],
    [{ from: "2025-03" }, "no end, not even null"],
  ] as [object, string][])("rejects the period %j (%s)", (period) => {
    expect(knowledgeEntryDto.safeParse({ ...fixture("work-entry"), period }).success).toBe(false);
  });

  it("accepts an ongoing period", () => {
    const ongoing = { ...fixture("work-entry"), period: { from: "2024-09", to: null } };
    expect(knowledgeEntryDto.parse(ongoing).period).toEqual({ from: "2024-09", to: null });
  });

  it("does not expose a CV bullet's importance", () => {
    const list = fixture("experience") as { items: { bullets: object[] }[] };
    const bullet = { ...list.items[0]?.bullets[0], importance: 1 };
    const withImportance = { items: [{ ...list.items[0], bullets: [bullet] }] };
    expect(experienceListDto.parse(withImportance).items[0]?.bullets[0]).not.toHaveProperty(
      "importance",
    );
  });
});
