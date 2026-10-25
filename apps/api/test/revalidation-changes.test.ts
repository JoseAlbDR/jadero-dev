import {
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
} from "@jadero/contracts";
import archived from "@jadero/contracts/fixtures/content.archived.v1.json" with { type: "json" };
import published from "@jadero/contracts/fixtures/content.published.v1.json" with { type: "json" };
import approved from "@jadero/contracts/fixtures/knowledge.entry.approved.v1.json" with {
  type: "json",
};
import withdrawn from "@jadero/contracts/fixtures/knowledge.entry.withdrawn.v1.json" with {
  type: "json",
};
import { describe, expect, it } from "vitest";
import {
  changesForArchived,
  changesForKnowledgeEntry,
  changesForPublished,
} from "../src/modules/revalidation/revalidation-changes.js";

const PROJECT = "0199f3a2-1b7c-7e10-8d4f-2a6b9c0d1e3f";
const ID = "0199f3a2-0000-7000-8000-000000000001";

/** The published fixture's data with another aggregate's branch, parsed by the contract. */
function publishedAs(data: Record<string, unknown>) {
  return contentPublishedV1.data.parse({
    id: ID,
    locale: "en",
    revision: { id: ID, number: 1 },
    publishedAt: "2026-11-03T10:12:00.120Z",
    ...data,
  });
}

/** An archive tombstone parsed by the contract. */
function archivedAs(data: Record<string, unknown>) {
  return contentArchivedV1.data.parse({ id: ID, archivedAt: "2026-11-03T10:12:00.120Z", ...data });
}

describe("changesForPublished", () => {
  it("names a project by id and the localized slug it went live under, not its canonical slug", () => {
    expect(changesForPublished(contentPublishedV1.data.parse(published.data))).toEqual([
      { kind: "project", id: PROJECT, slug: "jobportal" },
    ]);
  });

  it("names a post by id and its localized slug", () => {
    const data = publishedAs({
      aggregate: "post",
      item: { slug: "outbox", kind: "post", wp: null },
      document: { slug: "der-outbox", title: "T", excerpt: "E", body: "B", tags: [] },
    });
    expect(changesForPublished(data)).toEqual([{ kind: "post", id: ID, slug: "der-outbox" }]);
  });

  it.each([
    ["profile", { item: {}, document: { name: "N", headline: "H", summary: "S", links: [] } }],
    ["now", { item: {}, document: { body: "B" } }],
    [
      "skill",
      { item: { sortOrder: 1 }, document: { name: "N", category: "backend", projectSlugs: [] } },
    ],
  ])("names a %s by id only: web tags it by type", (aggregate, rest) => {
    expect(changesForPublished(publishedAs({ aggregate, ...rest }))).toEqual([
      { kind: aggregate, id: ID },
    ]);
  });

  it("names a CV bullet by its kebab id", () => {
    const data = publishedAs({
      aggregate: "cv-bullet",
      id: "outbox-relay",
      item: {
        parent: { kind: "experience-item", experienceItemId: ID },
        sortOrder: 1,
        importance: 1,
      },
      document: { text: "Built the relay." },
    });
    expect(changesForPublished(data)).toEqual([{ kind: "cv-bullet", id: "outbox-relay" }]);
  });
});

describe("changesForArchived", () => {
  it("names a project once per distinct published slug", () => {
    expect(changesForArchived(contentArchivedV1.data.parse(archived.data))).toEqual([
      { kind: "project", id: "0199f3a2-5d6e-7f80-9a1b-2c3d4e5f6a7b", slug: "app-de-tareas" },
      { kind: "project", id: "0199f3a2-5d6e-7f80-9a1b-2c3d4e5f6a7b", slug: "todo-app" },
    ]);
  });

  it("names a post whose locales share one slug once", () => {
    const data = archivedAs({ aggregate: "post", slugs: { es: "outbox", en: "outbox" } });
    expect(changesForArchived(data)).toEqual([{ kind: "post", id: ID, slug: "outbox" }]);
  });

  it("names nothing for a project with no published slug, which the producer never sends", () => {
    expect(changesForArchived(archivedAs({ aggregate: "project", slugs: {} }))).toEqual([]);
  });

  it.each(["experience-item", "skill"])("names a %s by id only", (aggregate) => {
    expect(changesForArchived(archivedAs({ aggregate }))).toEqual([{ kind: aggregate, id: ID }]);
  });

  it("names a CV bullet by its kebab id", () => {
    expect(changesForArchived(archivedAs({ aggregate: "cv-bullet", id: "outbox-relay" }))).toEqual([
      { kind: "cv-bullet", id: "outbox-relay" },
    ]);
  });
});

describe("changesForKnowledgeEntry", () => {
  it("names an approved entry by its kb- id, with no locale", () => {
    expect(changesForKnowledgeEntry(knowledgeEntryApprovedV1.data.parse(approved.data))).toEqual([
      { kind: "knowledge-entry", id: approved.data.entryId },
    ]);
  });

  it("names a withdrawn entry the same way", () => {
    expect(changesForKnowledgeEntry(knowledgeEntryWithdrawnV1.data.parse(withdrawn.data))).toEqual([
      { kind: "knowledge-entry", id: "kb-outbox-relay" },
    ]);
  });
});
