import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  archivableAggregate,
  contentAggregate,
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
  knowledgeSnapshotV1,
  MAX_REVALIDATE_CHANGES,
  publishedSchema,
  REVALIDATE_MAX_SKEW_SECONDS,
  REVALIDATE_SIGNATURE_HEADER,
  revalidateChange,
  revalidateRequest,
  revalidateSignature,
} from "../src/index.js";

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  const url = new URL(`../fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Json;
}

/** The fixture of `routingKey` with its `data` replaced by `data`. */
function withData(routingKey: string, data: unknown): Json {
  return { ...fixture(routingKey), data };
}

/** The `aggregate` (or `kind`) literal of every member of a discriminated union, in order. */
function discriminators(
  options: readonly { shape: Record<string, unknown> }[],
  key: string,
): unknown[] {
  return options.map((o) => (o.shape[key] as { value: unknown }).value);
}

const uuid = "0199f3a2-1b7c-7e10-8d4f-2a6b9c0d1e3f";
const parentUuid = "0199f3a2-9a8b-7c6d-8e5f-4a3b2c1d0e9f";
const meta = {
  id: uuid,
  locale: "en",
  revision: { id: "01a1a0e4-7850-7d22-a6b1-0c1d2e3f4a5b", number: 1 },
  publishedAt: "2026-11-03T10:12:00.120Z",
};

describe("content.published.v1", () => {
  const published = fixture("content.published.v1");
  const data = published.data as Json;

  it("has one member per publishable content type, the same names as the read side", () => {
    expect(discriminators(contentPublishedV1.data.options, "aggregate")).toEqual(
      contentAggregate.options,
    );
  });

  // One valid data object per aggregate: what a publish of each type writes.
  const examples: [string, Json][] = [
    [
      "profile",
      {
        aggregate: "profile",
        ...meta,
        item: {},
        document: {
          name: "Jose",
          headline: "Backend engineer",
          summary: "Builds services.",
          links: [{ kind: "github", url: "https://github.com/example" }],
        },
      },
    ],
    ["now", { aggregate: "now", ...meta, item: {}, document: { body: "Building WP-14." } }],
    [
      "experience-item",
      {
        aggregate: "experience-item",
        ...meta,
        item: { sortOrder: 1 },
        document: {
          organization: "Example GmbH",
          role: "Backend engineer",
          period: { from: "2024-10", to: null },
          locationType: "remote",
          stackTags: ["NestJS"],
        },
      },
    ],
    ["project", data],
    [
      "post",
      {
        aggregate: "post",
        ...meta,
        item: { slug: "wp-14", kind: "journal", wp: 14 },
        document: {
          slug: "wp-14",
          title: "Content events",
          excerpt: "Events on publish.",
          body: "Text.",
          tags: ["messaging"],
        },
      },
    ],
    [
      "skill",
      {
        aggregate: "skill",
        ...meta,
        item: { sortOrder: 3 },
        document: { name: "RabbitMQ", category: "messaging", projectSlugs: ["jobs-hub"] },
      },
    ],
    [
      "cv-bullet",
      {
        aggregate: "cv-bullet",
        ...meta,
        id: "backend-10",
        item: {
          parent: { kind: "experience-item", experienceItemId: parentUuid },
          sortOrder: 0,
          importance: 1,
        },
        document: { text: "Built the outbox relay." },
      },
    ],
  ];

  it.each(examples)("parses a %s publish unchanged", (_, example) => {
    expect(contentPublishedV1.data.parse(example)).toEqual(example);
  });

  it("refuses a document of another type: the aggregate decides the schema", () => {
    const wrong = { ...data, aggregate: "post" };
    expect(
      contentPublishedV1.envelope.safeParse(withData("content.published.v1", wrong)).success,
    ).toBe(false);
  });

  it("refuses what the public API would refuse: a blank title, a non-HTTPS link", () => {
    const document = data.document as Json;
    const blank = { ...data, document: { ...document, title: "  " } };
    const script = { ...data, document: { ...document, repoUrl: "javascript:alert(1)" } };
    expect(contentPublishedV1.data.safeParse(blank).success).toBe(false);
    expect(contentPublishedV1.data.safeParse(script).success).toBe(false);
  });

  it("refuses a revision without a positive number, since consumers order by it", () => {
    const zero = { ...data, revision: { id: meta.revision.id, number: 0 } };
    const { revision: _r, ...without } = data;
    expect(contentPublishedV1.data.safeParse(zero).success).toBe(false);
    expect(contentPublishedV1.data.safeParse(without).success).toBe(false);
  });

  it("refuses an event without a locale: one event names one locale", () => {
    const { locale: _l, ...without } = data;
    expect(contentPublishedV1.data.safeParse(without).success).toBe(false);
  });

  it("drops fields the public read does not show, such as the cross-locale alternates", () => {
    const extra = { ...data, document: { ...(data.document as Json), alternates: { es: "x" } } };
    const parsed = contentPublishedV1.data.parse(extra);
    expect(parsed.document).not.toHaveProperty("alternates");
  });

  it("takes a CV bullet's human id, and a UUID for every other type", () => {
    const cvBullet = examples.find(([name]) => name === "cv-bullet")?.[1] as Json;
    expect(contentPublishedV1.data.safeParse({ ...cvBullet, id: uuid }).success).toBe(true);
    expect(contentPublishedV1.data.safeParse({ ...data, id: "backend-10" }).success).toBe(false);
  });
});

describe("content.archived.v1", () => {
  const archived = fixture("content.archived.v1");
  const data = archived.data as Json;

  it("has one member per archivable type, and none for the singletons", () => {
    expect(discriminators(contentArchivedV1.data.options, "aggregate")).toEqual(
      archivableAggregate.options,
    );
    const profile = { aggregate: "profile", id: uuid, archivedAt: data.archivedAt };
    expect(contentArchivedV1.data.safeParse(profile).success).toBe(false);
  });

  it("is a tombstone: a document sent by mistake is dropped", () => {
    const parsed = contentArchivedV1.data.parse({ ...data, document: { title: "Todo app" } });
    expect(parsed).not.toHaveProperty("document");
  });

  it("needs the published slugs of a project, which name its pages in web's cache", () => {
    const { slugs: _s, ...without } = data;
    expect(contentArchivedV1.data.safeParse(without).success).toBe(false);
  });

  it("needs no slugs for a type whose pages are not tagged by slug", () => {
    const skill = { aggregate: "skill", id: uuid, archivedAt: data.archivedAt };
    expect(contentArchivedV1.data.parse(skill)).toEqual(skill);
  });
});

describe("knowledge.entry.approved.v1", () => {
  const approved = fixture("knowledge.entry.approved.v1");
  const data = approved.data as Json;
  const document = data.document as Json;
  const privateFields = { sources: ["design notes"], conflicts: "none", publicNames: ["Acme"] };

  // ADR-031: the private provenance never leaves `api`. A producer bug that put it in the data
  // must not reach a consumer's database or logs, at either level of the event.
  it("never lets sources, conflicts or publicNames through a parse", () => {
    const leaky = { ...data, ...privateFields, document: { ...document, ...privateFields } };
    const parsed = knowledgeEntryApprovedV1.envelope.parse(
      withData("knowledge.entry.approved.v1", leaky),
    );
    for (const key of Object.keys(privateFields)) {
      expect(parsed.data).not.toHaveProperty(key);
      expect(parsed.data.document).not.toHaveProperty(key);
    }
  });

  it("does not name a private field anywhere in its frozen schema", () => {
    const schema = JSON.stringify(publishedSchema(knowledgeEntryApprovedV1));
    for (const key of Object.keys(privateFields)) expect(schema).not.toContain(`"${key}"`);
  });

  it("carries confidence, the one provenance field the agent needs", () => {
    expect(knowledgeEntryApprovedV1.data.parse(data).confidence).toBe("high");
    expect(knowledgeEntryApprovedV1.data.safeParse({ ...data, confidence: "sure" }).success).toBe(
      false,
    );
  });

  it("requires a locale from the start, so per-locale entries need no new version", () => {
    const { locale: _l, ...without } = data;
    expect(knowledgeEntryApprovedV1.data.safeParse(without).success).toBe(false);
    expect(knowledgeEntryApprovedV1.data.safeParse({ ...data, locale: "de" }).success).toBe(true);
  });

  it("refuses an approval state other than approved", () => {
    const approval = { ...(data.approval as Json), state: "in_review" };
    expect(knowledgeEntryApprovedV1.data.safeParse({ ...data, approval }).success).toBe(false);
  });

  it("refuses a document the public work page would refuse: no questions", () => {
    const bad = { ...data, document: { ...document, questions: [] } };
    expect(knowledgeEntryApprovedV1.data.safeParse(bad).success).toBe(false);
  });
});

describe("knowledge.entry.withdrawn.v1", () => {
  const data = fixture("knowledge.entry.withdrawn.v1").data as Json;

  it.each(["withdrawn", "deleted"])("accepts the reason %s", (reason) => {
    expect(knowledgeEntryWithdrawnV1.data.safeParse({ ...data, reason }).success).toBe(true);
  });

  it("refuses another reason", () => {
    expect(knowledgeEntryWithdrawnV1.data.safeParse({ ...data, reason: "expired" }).success).toBe(
      false,
    );
  });

  it("refuses a tombstone without the live revision, which consumers order it by", () => {
    const { revision: _r, ...without } = data;
    expect(knowledgeEntryWithdrawnV1.data.safeParse(without).success).toBe(false);
  });

  it("refuses a revision without a positive number", () => {
    const revision = { ...(data.revision as Json), number: 0 };
    expect(knowledgeEntryWithdrawnV1.data.safeParse({ ...data, revision }).success).toBe(false);
  });

  it("is a tombstone: a document sent by mistake is dropped", () => {
    const parsed = knowledgeEntryWithdrawnV1.data.parse({ ...data, document: { title: "x" } });
    expect(parsed).not.toHaveProperty("document");
  });
});

describe("knowledge.snapshot.v1", () => {
  const data = fixture("knowledge.snapshot.v1").data as Json;

  it("accepts an empty list: no entry approved is a valid state to reconcile to", () => {
    expect(knowledgeSnapshotV1.data.safeParse({ ...data, entries: [] }).success).toBe(true);
  });

  it("refuses a snapshot without asOf, which bounds what a consumer may delete", () => {
    const { asOf: _a, ...without } = data;
    expect(knowledgeSnapshotV1.data.safeParse(without).success).toBe(false);
  });
});

describe("revalidateRequest", () => {
  const change = { kind: "project", id: uuid, slug: "jobportal" };

  it("names every content type and knowledge entries, the things web caches", () => {
    expect(discriminators(revalidateChange.options, "kind")).toEqual([
      ...contentAggregate.options,
      "knowledge-entry",
    ]);
  });

  it("needs the localized slug of a project or a post, which web's item tags hold", () => {
    expect(revalidateChange.safeParse({ kind: "project", id: uuid }).success).toBe(false);
    expect(revalidateChange.safeParse({ kind: "post", id: uuid }).success).toBe(false);
  });

  it("takes a knowledge entry by its kb- id", () => {
    const entry = { kind: "knowledge-entry", id: "kb-outbox-relay" };
    expect(revalidateChange.parse(entry)).toEqual(entry);
    expect(revalidateChange.safeParse({ ...entry, id: uuid }).success).toBe(false);
  });

  it("refuses cache tags: web owns them (WP-14 Q1 B)", () => {
    expect(revalidateRequest.safeParse({ tags: ["content:projects"] }).success).toBe(false);
  });

  it("refuses a kind web does not cache", () => {
    expect(revalidateChange.safeParse({ kind: "page", id: uuid }).success).toBe(false);
    expect(revalidateRequest.safeParse({ changes: [{ kind: "page", id: uuid }] }).success).toBe(
      false,
    );
  });

  it("refuses an empty list and a list over the limit", () => {
    expect(revalidateRequest.safeParse({ changes: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_REVALIDATE_CHANGES + 1 }, () => change);
    expect(revalidateRequest.safeParse({ changes: many }).success).toBe(false);
    expect(revalidateRequest.safeParse({ changes: many.slice(1) }).success).toBe(true);
  });
});

describe("revalidateSignature", () => {
  const digest = "a".repeat(64);

  it("parses the timestamp and the hex digest", () => {
    expect(revalidateSignature.parse(`t=1793700721,v1=${digest}`)).toEqual({
      timestamp: 1793700721,
      digest,
    });
  });

  it.each([
    ["no timestamp", `v1=${digest}`],
    ["a short digest", "t=1793700721,v1=abc"],
    ["an uppercase digest", `t=1793700721,v1=${"A".repeat(64)}`],
    ["another scheme", `t=1793700721,v0=${digest}`],
    ["extra parts", `t=1793700721,v1=${digest},v2=${digest}`],
    ["a negative timestamp", `t=-1,v1=${digest}`],
    ["an empty value", ""],
  ])("refuses %s", (_name, value) => {
    expect(revalidateSignature.safeParse(value).success).toBe(false);
  });

  it("names the header in lowercase and allows five minutes of clock skew", () => {
    expect(REVALIDATE_SIGNATURE_HEADER).toBe("x-jadero-signature");
    expect(REVALIDATE_MAX_SKEW_SECONDS).toBe(300);
  });
});
