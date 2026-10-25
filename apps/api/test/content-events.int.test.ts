import { fileURLToPath } from "node:url";
import {
  type CloudEventEnvelope,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
} from "@jadero/contracts";
import { runMigrations } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentEventWriterContract } from "../src/modules/content/application/content-event-writer.contract.js";
import { ApproveKnowledgeEntry } from "../src/modules/content/application/use-cases/approve-knowledge-entry.use-case.js";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import { CreateKnowledgeEntry } from "../src/modules/content/application/use-cases/create-knowledge-entry.use-case.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import { ConcurrentModification } from "../src/modules/content/domain/content.errors.js";
import type { Locale } from "../src/modules/content/domain/locale.js";
import type { ProjectDocument } from "../src/modules/content/domain/project.js";
import { DrizzleContentUnitOfWork } from "../src/modules/content/infrastructure/drizzle-content.unit-of-work.js";
import { SystemClock } from "../src/modules/content/infrastructure/system-clock.js";
import { UuidV7IdGenerator } from "../src/modules/content/infrastructure/uuid-v7-id-generator.js";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-14 step 3 on Postgres (ADR-012, D1): the event writer contract the in-memory fake passes in
// `pnpm verify`, here on `messaging.outbox` through the Drizzle unit of work; then the real use
// cases: a committed publish leaves exactly one unsent row per locale that moved, a rolled-back one
// leaves none, and an approval's row holds no private provenance. Tests run one after another and
// each starts from an empty outbox.
let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createContentTestDatabase();
  drop = database.drop;
  await runMigrations({
    service: "api",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  pool = new pg.Pool({ connectionString: database.url, max: 4 });
});

afterAll(async () => {
  await pool.end();
  await drop();
});

interface OutboxRow {
  routing_key: string;
  type: string;
  published_at: Date | null;
  envelope: CloudEventEnvelope;
}

/** The committed outbox rows, read on another connection, oldest first. */
async function outboxRows(): Promise<OutboxRow[]> {
  const { rows } = await pool.query<OutboxRow>(
    "SELECT routing_key, type, published_at, envelope FROM messaging.outbox ORDER BY created_at, id",
  );
  return rows;
}

contentEventWriterContract("Drizzle on Postgres", async () => {
  await pool.query("TRUNCATE messaging.outbox");
  return {
    unitOfWork: new DrizzleContentUnitOfWork(pool),
    outbox: async () =>
      (await outboxRows()).map((row) => ({ routingKey: row.routing_key, envelope: row.envelope })),
  };
});

describe("the content use cases write their events in the publish transaction", () => {
  const uow = () => new DrizzleContentUnitOfWork(pool);
  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator();
  let create: CreateContentItem;
  let save: SaveContentRevision;
  let publish: PublishContentItem;

  beforeEach(async () => {
    await pool.query("TRUNCATE messaging.outbox");
    create = new CreateContentItem(uow(), ids);
    save = new SaveContentRevision(uow(), ids, clock);
    publish = new PublishContentItem(uow(), clock);
  });

  /** A complete document; `slug` must be unique per locale among published projects. */
  function projectDoc(locale: Locale, slug: string, title = "Events sample"): ProjectDocument {
    return {
      slug: `${locale}-${slug}`,
      title,
      summary: "A placeholder.",
      body: "Placeholder text.",
      stackTags: ["PostgreSQL"],
      repoUrl: null,
      demoUrl: null,
    };
  }

  /** A project with es and en saved, not published; returns its id and version (3). */
  async function draftProject(): Promise<{ id: string; slug: string; version: number }> {
    const slug = `events-${ids.next().slice(-8)}`;
    let { id, version } = await create.execute({
      type: "project",
      slug,
      kind: "project",
      featured: false,
      sortOrder: 1,
    });
    for (const locale of ["es", "en"] as const) {
      ({ version } = await save.execute({
        type: "project",
        id,
        locale,
        document: projectDoc(locale, slug),
        expectedVersion: version,
      }));
    }
    return { id, slug, version };
  }

  it("a committed publish leaves exactly one unsent content.published.v1 row per locale", async () => {
    const { id, version } = await draftProject();
    const result = await publish.execute({
      type: "project",
      id,
      locales: ["es", "en"],
      expectedVersion: version,
    });

    const rows = await outboxRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        routing_key: contentPublishedV1.routingKey,
        type: contentPublishedV1.type,
        published_at: null,
        envelope: { source: "jadero/api", data: { aggregate: "project", id } },
      });
    }
    expect(rows.map((row) => (row.envelope.data as { locale: string }).locale).sort()).toEqual([
      "en",
      "es",
    ]);
    expect(
      rows.map((row) => (row.envelope.data as { revision: { id: string } }).revision.id).sort(),
    ).toEqual(result.published.map((p) => p.revisionId).sort());
  });

  it("a publish that loses the version check leaves no row, and the earlier rows stay", async () => {
    const { id, slug, version } = await draftProject();
    await publish.execute({ type: "project", id, locales: ["es", "en"], expectedVersion: version });
    const { version: next } = await save.execute({
      type: "project",
      id,
      locale: "en",
      document: projectDoc("en", slug, "Events sample, revised"),
      expectedVersion: version + 1,
    });
    expect(next).toBe(version + 2);

    // Another tab published from the version before the revision: a stale expectedVersion.
    await expect(
      publish.execute({ type: "project", id, locales: ["en"], expectedVersion: version + 1 }),
    ).rejects.toBeInstanceOf(ConcurrentModification);

    expect(await outboxRows()).toHaveLength(2);
  });

  it("a caller's run that fails after the publish rolls its rows back with the pointers", async () => {
    const { id, version } = await draftProject();
    const failure = new Error("a later step of the same unit of work failed");
    await expect(
      uow().run(async (scope) => {
        const result = await publish.executeIn(scope, {
          type: "project",
          id,
          locales: ["es", "en"],
          expectedVersion: version,
        });
        expect(result.published).toHaveLength(2);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await outboxRows()).toEqual([]);
    const { rows } = await pool.query(
      "SELECT published_revision_id FROM content.project_translations WHERE project_id = $1",
      [id],
    );
    expect(rows.every((row) => row.published_revision_id === null)).toBe(true);
  });

  it("an approval's outbox row carries no private provenance", async () => {
    const createEntry = new CreateKnowledgeEntry(uow(), ids, clock);
    const approve = new ApproveKnowledgeEntry(uow(), clock);
    const entryId = `kb-events-${ids.next().slice(-8)}`;
    const { revisionId } = await createEntry.execute({
      id: entryId,
      document: {
        title: "Events sample entry",
        type: "feature",
        domain: "messaging",
        period: { from: "2024-01", to: null },
        role: "sole author",
        sections: [
          { key: "summary", body: "Summary." },
          { key: "problem", body: "Problem." },
          { key: "whatHeBuilt", body: "What was built." },
        ],
        questions: ["How does it work?"],
        stack: [],
        patterns: [],
        related: [],
        cvBullet: null,
        indexable: true,
      },
      provenance: {
        sources: ["PRIVATE-SOURCE"],
        conflicts: "PRIVATE-CONFLICT",
        publicNames: ["PRIVATE-NAME"],
        confidence: "high",
      },
    });
    await approve.execute({
      id: entryId,
      revisionId,
      checklist: {
        noClientNames: true,
        noInternalNames: true,
        noNonPublicNumbers: true,
        noEmployerCode: true,
        ownVoice: true,
      },
      expectedVersion: 1,
    });

    const { rows } = await pool.query<{ routing_key: string; envelope_text: string }>(
      "SELECT routing_key, envelope::text AS envelope_text FROM messaging.outbox",
    );
    expect(rows.map((row) => row.routing_key)).toEqual([knowledgeEntryApprovedV1.routingKey]);
    expect(rows[0]?.envelope_text).toContain('"confidence": "high"');
    expect(rows[0]?.envelope_text).not.toContain("PRIVATE");
  });
});
