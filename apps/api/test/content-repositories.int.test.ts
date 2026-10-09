import { fileURLToPath } from "node:url";
import { drizzleOn, runMigrations } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  at,
  newEntry,
  newProject,
  saveProjectRevision,
} from "../src/modules/content/application/content.contract-fixtures.js";
import { contentUnitOfWorkContract } from "../src/modules/content/application/content.unit-of-work.contract.js";
import { knowledgeEntryRepositoryContract } from "../src/modules/content/application/knowledge-entry.repository.contract.js";
import { projectRepositoryContract } from "../src/modules/content/application/project.repository.contract.js";
import {
  ConcurrentModification,
  StoredStateInvalid,
} from "../src/modules/content/domain/content.errors.js";
import type { Project } from "../src/modules/content/domain/project.js";
import { DrizzleContentUnitOfWork } from "../src/modules/content/infrastructure/drizzle-content.unit-of-work.js";
import { DrizzleKnowledgeEntryRepository } from "../src/modules/content/infrastructure/drizzle-knowledge-entry.repository.js";
import { DrizzleProjectRepository } from "../src/modules/content/infrastructure/drizzle-project.repository.js";

// WP-12 step 5b: the contract suites the in-memory fakes pass in `pnpm verify`, here on the Drizzle
// adapters and the migrated content schema, as the ordinary owner role. Then what only Postgres can
// show: the rolled-back revision row is really gone, and a stored row the domain cannot read back
// fails as StoredStateInvalid. Every test writes fresh ids, so the tests share one database.
let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createTestDatabase();
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

const projects = () => new DrizzleProjectRepository(drizzleOn(pool));
const knowledgeEntries = () => new DrizzleKnowledgeEntryRepository(drizzleOn(pool));

projectRepositoryContract("Drizzle on Postgres", projects);
knowledgeEntryRepositoryContract("Drizzle on Postgres", knowledgeEntries);
contentUnitOfWorkContract("Drizzle on Postgres", () => ({
  unitOfWork: new DrizzleContentUnitOfWork(pool),
  // Outside any transaction: they see only what `run` committed.
  projects: projects(),
  knowledgeEntries: knowledgeEntries(),
}));

/** Counts a project's revision rows in one locale. */
async function revisionCount(projectId: string, locale: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*) FROM content.project_revisions WHERE project_id = $1 AND locale = $2",
    [projectId, locale],
  );
  return Number(rows[0]?.count);
}

/** A project with es and en at revision 1, stored at version 1. */
async function storedProject(): Promise<Project> {
  const project = newProject();
  saveProjectRevision(project, "es");
  saveProjectRevision(project, "en");
  await projects().save(project, 0);
  return project;
}

describe("Drizzle content unit of work on Postgres", () => {
  it("removes the revision row an earlier save inserted when a later save conflicts", async () => {
    const created = await storedProject();
    const stale = (await projects().get(created.id)) as Project;
    await expect(
      new DrizzleContentUnitOfWork(pool).run(async (scope) => {
        const fresh = (await scope.projects.get(created.id)) as Project;
        saveProjectRevision(fresh, "es", 1, "Rolled back");
        await scope.projects.save(fresh, 1);
        saveProjectRevision(stale, "es", 2, "Stale");
        await scope.projects.save(stale, 1);
      }),
    ).rejects.toBeInstanceOf(ConcurrentModification);
    expect(await revisionCount(created.id, "es")).toBe(1);
    const { rows } = await pool.query("SELECT version FROM content.projects WHERE id = $1", [
      created.id,
    ]);
    expect(rows).toEqual([{ version: 1 }]);
  });
});

describe("stored rows the domain cannot read back", () => {
  it("refuses a revision document that does not match its schema", async () => {
    const created = await storedProject();
    await pool.query(
      `UPDATE content.project_revisions SET document = '{"slug": 5}'
       WHERE project_id = $1 AND locale = 'es'`,
      [created.id],
    );
    await expect(projects().get(created.id)).rejects.toBeInstanceOf(StoredStateInvalid);
  });

  it("refuses a published slug that differs from the published revision's slug", async () => {
    const created = await storedProject();
    const loaded = (await projects().get(created.id)) as Project;
    loaded.publish(["es", "en"], at(3));
    await projects().save(loaded, 1);
    await pool.query(
      `UPDATE content.project_translations SET published_slug = $2
       WHERE project_id = $1 AND locale = 'es'`,
      [created.id, `elsewhere-${created.id.slice(0, 8)}`],
    );
    await expect(projects().get(created.id)).rejects.toThrow(/published slug differs/);
  });

  it("refuses an entry revision with no provenance row", async () => {
    const entry = newEntry();
    await knowledgeEntries().save(entry, 0);
    await pool.query("DELETE FROM content.knowledge_entry_provenance WHERE revision_id = $1", [
      entry.latest().id,
    ]);
    await expect(knowledgeEntries().get(entry.id)).rejects.toBeInstanceOf(StoredStateInvalid);
  });

  it("refuses an approval checklist that does not match its schema", async () => {
    const entry = newEntry();
    await knowledgeEntries().save(entry, 0);
    await pool.query(
      `UPDATE content.knowledge_entries
       SET state = 'approved', approved_revision_id = $2, approved_at = now(),
           approval_checklist = '{"ownVoice": "yes"}'
       WHERE id = $1`,
      [entry.id, entry.latest().id],
    );
    await expect(knowledgeEntries().get(entry.id)).rejects.toBeInstanceOf(StoredStateInvalid);
  });
});
