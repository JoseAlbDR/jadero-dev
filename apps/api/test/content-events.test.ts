import {
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
} from "@jadero/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import type { WrittenContentEvent } from "../src/modules/content/application/content-event-writer.js";
import {
  knowledgeEntryApproved,
  PROJECT_EVENTS,
} from "../src/modules/content/application/content-events.js";
import { ApproveKnowledgeEntry } from "../src/modules/content/application/use-cases/approve-knowledge-entry.use-case.js";
import { ArchiveContentItem } from "../src/modules/content/application/use-cases/archive-content-item.use-case.js";
import type {
  CreateContentItemCommand,
  SaveContentRevisionCommand,
} from "../src/modules/content/application/use-cases/content-commands.js";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import { CreateKnowledgeEntry } from "../src/modules/content/application/use-cases/create-knowledge-entry.use-case.js";
import { DeleteKnowledgeEntry } from "../src/modules/content/application/use-cases/delete-knowledge-entry.use-case.js";
import { ImportJournalPost } from "../src/modules/content/application/use-cases/import-journal-post.use-case.js";
import type { LocalizedType } from "../src/modules/content/application/use-cases/localized-types.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { PublishJournalPost } from "../src/modules/content/application/use-cases/publish-journal-post.use-case.js";
import { RequestKnowledgeEntryChanges } from "../src/modules/content/application/use-cases/request-knowledge-entry-changes.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import { SaveKnowledgeEntryRevision } from "../src/modules/content/application/use-cases/save-knowledge-entry-revision.use-case.js";
import { SeedContent } from "../src/modules/content/application/use-cases/seed-content.use-case.js";
import { SubmitKnowledgeEntry } from "../src/modules/content/application/use-cases/submit-knowledge-entry.use-case.js";
import { WithdrawKnowledgeEntry } from "../src/modules/content/application/use-cases/withdraw-knowledge-entry.use-case.js";
import type { ApprovalChecklist } from "../src/modules/content/domain/approval-checklist.js";
import {
  ConcurrentModification,
  RequiredLocalesMissing,
} from "../src/modules/content/domain/content.errors.js";
import {
  KnowledgeEntry,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
} from "../src/modules/content/domain/knowledge-entry.js";
import type { Locale } from "../src/modules/content/domain/locale.js";
import { Project } from "../src/modules/content/domain/project.js";
import { contentSeed } from "../src/seed/content-seed-data.js";
import { type ContentPorts, contentPorts } from "./content-use-case.fakes.js";

// WP-14 step 3: what each content use case writes to the outbox (D1, Q2 A), on the in-memory unit
// of work and its event writer. The right events and the right count, none on a no-op or a refused
// change, and no private knowledge field in any event (ADR-031). The Postgres twin of the rollback
// is `content-events.int.test.ts`.

const EXPERIENCE = "01990000-0000-7000-8000-00000000b001";
const PROJECT = "01990000-0000-7000-8000-00000000b002";
const POST = "01990000-0000-7000-8000-00000000b003";
const SKILL = "01990000-0000-7000-8000-00000000b004";
const PROFILE = "01990000-0000-7000-8000-00000000b005";
const NOW = "01990000-0000-7000-8000-00000000b006";
const BULLET = "events-1";
const ENTRY = "kb-events-entry";
const NOON = "2026-10-10T10:00:00.000Z";

const ALL_TICKED: ApprovalChecklist = {
  noClientNames: true,
  noInternalNames: true,
  noNonPublicNumbers: true,
  noEmployerCode: true,
  ownVoice: true,
};

/** Private provenance with markers no event may ever carry. */
const PRIVATE: KnowledgeEntryProvenance = {
  sources: ["PRIVATE-SOURCE-design-notes"],
  conflicts: "PRIVATE-CONFLICT the two notes disagree",
  publicNames: ["PRIVATE-NAME"],
  confidence: "medium",
};

/** One create command and one complete document per localized type. */
const TYPES: {
  readonly [K in LocalizedType]: {
    readonly create: CreateContentItemCommand & { readonly type: K };
    readonly id: string;
    readonly document: (
      locale: Locale,
    ) => Extract<SaveContentRevisionCommand, { type: K }>["document"];
  };
} = {
  profile: {
    create: { type: "profile", id: PROFILE },
    id: PROFILE,
    document: (locale) => ({
      name: `Alex (${locale})`,
      headline: "Engineer",
      summary: "Placeholder.",
      links: [{ kind: "website", url: "https://example.com" }],
    }),
  },
  now: {
    create: { type: "now", id: NOW },
    id: NOW,
    document: (locale) => ({ body: `Building events (${locale}).` }),
  },
  "experience-item": {
    create: { type: "experience-item", id: EXPERIENCE, sortOrder: 3 },
    id: EXPERIENCE,
    document: () => ({
      organization: "Example Company",
      role: "Engineer",
      period: { from: "2024-01", to: null },
      locationType: "remote",
      stackTags: ["NestJS"],
    }),
  },
  project: {
    create: {
      type: "project",
      id: PROJECT,
      slug: "sample",
      kind: "case_study",
      featured: true,
      sortOrder: 2,
    },
    id: PROJECT,
    document: (locale) => ({
      slug: `${locale}-sample`,
      title: `Sample (${locale})`,
      summary: "A placeholder.",
      body: "Placeholder text.",
      stackTags: ["TypeScript"],
      repoUrl: "https://example.com/repo",
      demoUrl: null,
    }),
  },
  post: {
    create: { type: "post", id: POST, slug: "sample-post" },
    id: POST,
    document: (locale) => ({
      slug: `${locale}-post`,
      title: "Sample",
      excerpt: "",
      body: "Placeholder.",
      tags: ["notes"],
    }),
  },
  skill: {
    create: { type: "skill", id: SKILL, sortOrder: 1 },
    id: SKILL,
    document: () => ({ name: "NestJS", category: "Backend", projectSlugs: ["sample"] }),
  },
  "cv-bullet": {
    create: {
      type: "cv-bullet",
      id: BULLET,
      parent: { kind: "project", projectId: PROJECT },
      sortOrder: 4,
      importance: 2,
    },
    id: BULLET,
    document: (locale) => ({ text: `Built a sample (${locale}).` }),
  },
};

/** The `item` field each type's event carries: its base-row fields. */
const ITEMS: { readonly [K in LocalizedType]: object } = {
  profile: {},
  now: {},
  "experience-item": { sortOrder: 3 },
  project: { slug: "sample", kind: "case_study", featured: true, sortOrder: 2 },
  post: { slug: "sample-post", kind: "post", wp: null },
  skill: { sortOrder: 1 },
  "cv-bullet": { parent: { kind: "project", projectId: PROJECT }, sortOrder: 4, importance: 2 },
};

const ALL_TYPES = Object.keys(TYPES) as LocalizedType[];

let ports: ContentPorts;
let create: CreateContentItem;
let save: SaveContentRevision;
let publish: PublishContentItem;
let archive: ArchiveContentItem;
let createEntry: CreateKnowledgeEntry;
let saveEntry: SaveKnowledgeEntryRevision;
let submit: SubmitKnowledgeEntry;
let requestChanges: RequestKnowledgeEntryChanges;
let approve: ApproveKnowledgeEntry;
let withdraw: WithdrawKnowledgeEntry;
let remove: DeleteKnowledgeEntry;

beforeEach(() => {
  ports = contentPorts();
  create = new CreateContentItem(ports.uow, ports.ids);
  save = new SaveContentRevision(ports.uow, ports.ids, ports.clock);
  publish = new PublishContentItem(ports.uow, ports.clock);
  archive = new ArchiveContentItem(ports.uow, ports.clock);
  createEntry = new CreateKnowledgeEntry(ports.uow, ports.ids, ports.clock);
  saveEntry = new SaveKnowledgeEntryRevision(ports.uow, ports.ids, ports.clock);
  submit = new SubmitKnowledgeEntry(ports.uow);
  requestChanges = new RequestKnowledgeEntryChanges(ports.uow);
  approve = new ApproveKnowledgeEntry(ports.uow, ports.clock);
  withdraw = new WithdrawKnowledgeEntry(ports.uow, ports.clock);
  remove = new DeleteKnowledgeEntry(ports.uow, ports.clock);
});

/** The committed outbox of the fake store. */
const outbox = (): readonly WrittenContentEvent[] => ports.store.events;

/** The data of every committed event with this routing key, in commit order. */
function dataOf(routingKey: string): unknown[] {
  return outbox()
    .filter((event) => event.routingKey === routingKey)
    .map((event) => event.envelope.data);
}

/** Creates an item and saves es, en and de; returns the version reached (4). */
async function createWithLocales(type: LocalizedType): Promise<number> {
  if (type === "cv-bullet") await create.execute(TYPES.project.create);
  let { version } = await create.execute(TYPES[type].create);
  for (const locale of ["es", "en", "de"] as const) {
    ({ version } = await save.execute({
      type,
      id: TYPES[type].id,
      locale,
      document: TYPES[type].document(locale),
      expectedVersion: version,
    } as SaveContentRevisionCommand));
  }
  return version;
}

/** Publishes the named locales of an item at the given version. */
function publishLocales(type: LocalizedType, version: number, locales: Locale[]) {
  return publish.execute({ type, id: TYPES[type].id, locales, expectedVersion: version });
}

function entryDocument(title = "Sample entry"): KnowledgeEntryDocument {
  return {
    title,
    type: "feature",
    domain: "messaging",
    period: { from: "2024-01", to: "2024-03" },
    role: "sole author",
    sections: [
      { key: "summary", body: "Summary." },
      { key: "problem", body: "Problem." },
      { key: "whatHeBuilt", body: "What was built." },
    ],
    questions: ["How does it work?"],
    stack: ["NestJS"],
    patterns: ["transactional outbox"],
    related: [],
    cvBullet: null,
    indexable: true,
  };
}

/** Creates the entry with private provenance and approves revision 1 (version 2). */
async function createApproved(): Promise<string> {
  const { revisionId } = await createEntry.execute({
    id: ENTRY,
    document: entryDocument(),
    provenance: PRIVATE,
  });
  await approve.execute({ id: ENTRY, revisionId, checklist: ALL_TICKED, expectedVersion: 1 });
  return revisionId;
}

describe("PublishContentItem writes content.published.v1", () => {
  it.each(ALL_TYPES)("one event per locale that moved, for a %s", async (type) => {
    const version = await createWithLocales(type);
    const before = outbox().length;
    const result = await publishLocales(type, version, ["es", "en", "de"]);

    const events = outbox().slice(before);
    expect(events.map((event) => event.routingKey)).toEqual(
      Array(3).fill(contentPublishedV1.routingKey),
    );
    expect(events.map((event) => event.envelope.data)).toEqual(
      result.published.map(({ locale, revisionId }) => ({
        aggregate: type,
        id: TYPES[type].id,
        locale,
        revision: { id: revisionId, number: 1 },
        publishedAt: NOON,
        item: ITEMS[type],
        document: TYPES[type].document(locale),
      })),
    );
    for (const { envelope } of events) {
      expect(envelope.type).toBe(contentPublishedV1.type);
      expect(envelope.source).toBe("jadero/api");
    }
  });

  it("writes only the locale that moved, with its new revision number", async () => {
    const version = await createWithLocales("project");
    await publishLocales("project", version, ["es", "en"]);
    const { version: next } = await save.execute({
      type: "project",
      id: PROJECT,
      locale: "en",
      document: { ...TYPES.project.document("en"), title: "Sample, revised" },
      expectedVersion: version + 1,
    });
    ports.clock.advance(5);

    await publishLocales("project", next, ["es", "en"]);

    const data = dataOf(contentPublishedV1.routingKey);
    expect(data).toHaveLength(3);
    expect(data[2]).toMatchObject({
      locale: "en",
      revision: { number: 2 },
      publishedAt: "2026-10-10T10:05:00.000Z",
      document: { title: "Sample, revised" },
    });
  });

  it("writes nothing when every named locale is already live", async () => {
    const version = await createWithLocales("project");
    await publishLocales("project", version, ["es", "en"]);
    const before = outbox().length;
    const again = await publishLocales("project", version + 1, ["es", "en"]);
    expect(again.published).toEqual([]);
    expect(outbox()).toHaveLength(before);
  });

  it("writes nothing when the domain refuses the publish or the version is stale", async () => {
    const version = await createWithLocales("project");
    await expect(publishLocales("project", version, ["es"])).rejects.toThrow(
      RequiredLocalesMissing,
    );
    await expect(publishLocales("project", version - 1, ["es", "en"])).rejects.toThrow(
      ConcurrentModification,
    );
    expect(outbox()).toEqual([]);
  });

  it("refuses to announce a locale that has no published revision", () => {
    const project = Project.create({
      id: PROJECT,
      slug: "sample",
      kind: "project",
      featured: false,
      sortOrder: 1,
    });
    expect(() => PROJECT_EVENTS.published(project, "es")).toThrow(/no published es revision/);
  });
});

describe("ArchiveContentItem writes content.archived.v1", () => {
  it.each([
    ["project", { es: "es-sample", en: "en-sample" }],
    ["post", { es: "es-post", en: "en-post" }],
  ] as const)(
    "a published %s leaves one tombstone with its published slugs",
    async (type, slugs) => {
      const version = await createWithLocales(type);
      await publishLocales(type, version, ["es", "en"]);
      ports.clock.advance(10);
      await archive.execute({ type, id: TYPES[type].id, expectedVersion: version + 1 });
      expect(dataOf(contentArchivedV1.routingKey)).toEqual([
        { aggregate: type, id: TYPES[type].id, archivedAt: "2026-10-10T10:10:00.000Z", slugs },
      ]);
    },
  );

  it.each(["experience-item", "skill", "cv-bullet"] as const)(
    "a published %s leaves one tombstone without slugs",
    async (type) => {
      const version = await createWithLocales(type);
      await publishLocales(type, version, ["es", "en", "de"]);
      await archive.execute({ type, id: TYPES[type].id, expectedVersion: version + 1 });
      expect(dataOf(contentArchivedV1.routingKey)).toEqual([
        { aggregate: type, id: TYPES[type].id, archivedAt: NOON },
      ]);
    },
  );

  it("writes nothing for an item that was never published", async () => {
    const version = await createWithLocales("skill");
    await archive.execute({ type: "skill", id: SKILL, expectedVersion: version });
    expect(outbox()).toEqual([]);
  });

  it("writes nothing when the archive is refused", async () => {
    const version = await createWithLocales("project");
    await publishLocales("project", version, ["es", "en"]);
    const before = outbox().length;
    await expect(
      archive.execute({ type: "project", id: PROJECT, expectedVersion: version }),
    ).rejects.toThrow(ConcurrentModification);
    expect(outbox()).toHaveLength(before);
  });
});

describe("the knowledge entry use cases write the knowledge events", () => {
  it("approve writes one knowledge.entry.approved.v1 with the public revision", async () => {
    const revisionId = await createApproved();
    expect(outbox().map((event) => event.routingKey)).toEqual([
      knowledgeEntryApprovedV1.routingKey,
    ]);
    expect(dataOf(knowledgeEntryApprovedV1.routingKey)).toEqual([
      {
        entryId: ENTRY,
        locale: "en",
        revision: { id: revisionId, number: 1 },
        approval: { state: "approved", approvedAt: NOON },
        document: entryDocument(),
        confidence: "medium",
      },
    ]);
  });

  it("never puts sources, conflicts or public names in an event", async () => {
    await createApproved();
    await withdraw.execute({ id: ENTRY, expectedVersion: 2 });
    expect(outbox()).toHaveLength(2);
    for (const { envelope } of outbox()) {
      const text = JSON.stringify(envelope);
      expect(text).not.toContain("PRIVATE");
      for (const key of ["sources", "conflicts", "publicNames", "provenance"]) {
        expect(text).not.toContain(`"${key}"`);
      }
    }
  });

  it("an approval of the revision already approved writes nothing", async () => {
    const revisionId = await createApproved();
    await approve.execute({ id: ENTRY, revisionId, checklist: ALL_TICKED, expectedVersion: 2 });
    expect(outbox()).toHaveLength(1);
  });

  it("approving a newer revision writes a second event with its number", async () => {
    await createApproved();
    const { revisionId } = await saveEntry.execute({
      id: ENTRY,
      document: entryDocument("Sample entry, revised"),
      provenance: PRIVATE,
      expectedVersion: 2,
    });
    await approve.execute({ id: ENTRY, revisionId, checklist: ALL_TICKED, expectedVersion: 3 });
    const data = dataOf(knowledgeEntryApprovedV1.routingKey);
    expect(data).toHaveLength(2);
    expect(data[1]).toMatchObject({
      revision: { id: revisionId, number: 2 },
      document: { title: "Sample entry, revised" },
    });
  });

  it("draft-side transitions (save, submit, request changes) write nothing", async () => {
    await createEntry.execute({ id: ENTRY, document: entryDocument(), provenance: PRIVATE });
    await submit.execute({ id: ENTRY, expectedVersion: 1 });
    await requestChanges.execute({ id: ENTRY, expectedVersion: 2 });
    expect(outbox()).toEqual([]);
  });

  it("withdraw writes a tombstone with reason withdrawn", async () => {
    await createApproved();
    ports.clock.advance(1);
    await withdraw.execute({ id: ENTRY, expectedVersion: 2 });
    expect(dataOf(knowledgeEntryWithdrawnV1.routingKey)).toEqual([
      { entryId: ENTRY, locale: "en", reason: "withdrawn", at: "2026-10-10T10:01:00.000Z" },
    ]);
  });

  it("delete of an approved entry writes a tombstone with reason deleted", async () => {
    await createApproved();
    await remove.execute({ id: ENTRY, expectedVersion: 2 });
    expect(dataOf(knowledgeEntryWithdrawnV1.routingKey)).toEqual([
      { entryId: ENTRY, locale: "en", reason: "deleted", at: NOON },
    ]);
  });

  it("delete writes nothing when nothing was public: withdrawn first, or never approved", async () => {
    await createApproved();
    await withdraw.execute({ id: ENTRY, expectedVersion: 2 });
    await remove.execute({ id: ENTRY, expectedVersion: 3 });
    expect(dataOf(knowledgeEntryWithdrawnV1.routingKey)).toEqual([
      expect.objectContaining({ reason: "withdrawn" }),
    ]);

    await createEntry.execute({
      id: "kb-never-approved",
      document: entryDocument(),
      provenance: PRIVATE,
    });
    await remove.execute({ id: "kb-never-approved", expectedVersion: 1 });
    expect(outbox()).toHaveLength(2);
  });

  it("a refused transition writes nothing", async () => {
    await createApproved();
    await expect(withdraw.execute({ id: ENTRY, expectedVersion: 1 })).rejects.toThrow(
      ConcurrentModification,
    );
    expect(outbox()).toHaveLength(1);
  });

  it("refuses to announce an entry with no approval", () => {
    const entry = KnowledgeEntry.create({
      id: ENTRY,
      document: entryDocument(),
      provenance: PRIVATE,
      origin: "owner",
      revisionId: "0199ffff-0000-7000-8000-0000000000aa",
      at: new Date(NOON),
    });
    expect(() => knowledgeEntryApproved(entry)).toThrow(/no approval/);
  });
});

describe("the seed and the journal publish emit through the same publish path", () => {
  it("db:seed writes one content.published.v1 per published locale and one approval per entry", async () => {
    const seed = new SeedContent(ports.uow, create, save, publish, createEntry, approve);
    await seed.execute(contentSeed);

    const localized = contentSeed.filter((item) => item.type !== "knowledge-entry");
    const entries = contentSeed.filter((item) => item.type === "knowledge-entry");
    const published = dataOf(contentPublishedV1.routingKey) as { aggregate: string; id: string }[];
    expect(new Set(published.map((data) => `${data.aggregate}:${data.id}`)).size).toBe(
      localized.length,
    );
    expect(dataOf(knowledgeEntryApprovedV1.routingKey)).toHaveLength(entries.length);

    const before = outbox().length;
    await seed.execute(contentSeed);
    expect(outbox()).toHaveLength(before);
  });

  it("journal:publish writes one event per locale it published", async () => {
    const importPost = new ImportJournalPost(ports.uow, create, save);
    const document = (locale: Locale) => ({
      slug: `wp-14-${locale}`,
      title: `WP-14 (${locale})`,
      excerpt: "Content events.",
      body: "The outbox, again.",
      tags: ["messaging"],
    });
    for (const locale of ["es", "en"] as const) {
      await importPost.execute({ wp: 14, locale, document: document(locale) });
    }
    await new PublishJournalPost(ports.uow, publish).execute({ wp: 14 });
    expect(dataOf(contentPublishedV1.routingKey)).toEqual([
      expect.objectContaining({
        aggregate: "post",
        locale: "es",
        item: expect.objectContaining({ kind: "journal", wp: 14 }),
      }),
      expect.objectContaining({ aggregate: "post", locale: "en" }),
    ]);
  });
});
