import { fileURLToPath } from "node:url";
import { drizzleOn, runMigrations } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  at,
  newCvBullet,
  newEntry,
  newExperienceItem,
  newPost,
  newProfile,
  newProject,
  savePostRevision,
  saveProfileRevision,
  saveProjectRevision,
} from "../src/modules/content/application/content.contract-fixtures.js";
import { contentUnitOfWorkContract } from "../src/modules/content/application/content.unit-of-work.contract.js";
import { cvBulletRepositoryContract } from "../src/modules/content/application/cv-bullet.repository.contract.js";
import { experienceItemRepositoryContract } from "../src/modules/content/application/experience-item.repository.contract.js";
import { knowledgeEntryRepositoryContract } from "../src/modules/content/application/knowledge-entry.repository.contract.js";
import { postRepositoryContract } from "../src/modules/content/application/post.repository.contract.js";
import { profileRepositoryContract } from "../src/modules/content/application/profile.repository.contract.js";
import { projectRepositoryContract } from "../src/modules/content/application/project.repository.contract.js";
import { skillRepositoryContract } from "../src/modules/content/application/skill.repository.contract.js";
import {
  ConcurrentModification,
  StoredStateInvalid,
} from "../src/modules/content/domain/content.errors.js";
import { CvBullet } from "../src/modules/content/domain/cv-bullet.js";
import type { Post } from "../src/modules/content/domain/post.js";
import type { Project } from "../src/modules/content/domain/project.js";
import { DrizzleContentUnitOfWork } from "../src/modules/content/infrastructure/drizzle-content.unit-of-work.js";
import { DrizzleCvBulletRepository } from "../src/modules/content/infrastructure/drizzle-cv-bullet.repository.js";
import { DrizzleExperienceItemRepository } from "../src/modules/content/infrastructure/drizzle-experience-item.repository.js";
import { DrizzleKnowledgeEntryRepository } from "../src/modules/content/infrastructure/drizzle-knowledge-entry.repository.js";
import { DrizzlePostRepository } from "../src/modules/content/infrastructure/drizzle-post.repository.js";
import { DrizzleProfileRepository } from "../src/modules/content/infrastructure/drizzle-profile.repository.js";
import { DrizzleProjectRepository } from "../src/modules/content/infrastructure/drizzle-project.repository.js";
import { DrizzleSkillRepository } from "../src/modules/content/infrastructure/drizzle-skill.repository.js";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-12 steps 5b and 5c: the contract suites the in-memory fakes pass in `pnpm verify`, here on the
// Drizzle adapters and the migrated content schema, as the ordinary owner role. Then what only
// Postgres can show: the rolled-back revision row is really gone, the singleton index and the
// parent foreign keys refuse what they must, an update leaves the parent columns alone, and a stored
// row the domain cannot read back fails as StoredStateInvalid. Every test writes fresh ids, so the
// tests share one database; the profile is a singleton, so its tests empty its tables first.
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

const profile = () => new DrizzleProfileRepository(drizzleOn(pool));
const experienceItems = () => new DrizzleExperienceItemRepository(drizzleOn(pool));
const projects = () => new DrizzleProjectRepository(drizzleOn(pool));
const posts = () => new DrizzlePostRepository(drizzleOn(pool));
const skills = () => new DrizzleSkillRepository(drizzleOn(pool));
const cvBullets = () => new DrizzleCvBulletRepository(drizzleOn(pool));
const knowledgeEntries = () => new DrizzleKnowledgeEntryRepository(drizzleOn(pool));

/** Deletes the profile, so a test can create the singleton again (pointers first, then rows). */
async function emptyProfile(): Promise<void> {
  await pool.query(
    "DELETE FROM content.profile_translations; DELETE FROM content.profile_revisions; DELETE FROM content.profile;",
  );
}

profileRepositoryContract("Drizzle on Postgres", async () => {
  await emptyProfile();
  return profile();
});
experienceItemRepositoryContract("Drizzle on Postgres", experienceItems);
projectRepositoryContract("Drizzle on Postgres", projects);
postRepositoryContract("Drizzle on Postgres", posts);
skillRepositoryContract("Drizzle on Postgres", skills);
cvBulletRepositoryContract("Drizzle on Postgres", () => ({
  cvBullets: cvBullets(),
  experienceItems: experienceItems(),
  projects: projects(),
}));
knowledgeEntryRepositoryContract("Drizzle on Postgres", knowledgeEntries);
contentUnitOfWorkContract("Drizzle on Postgres", async () => {
  await emptyProfile();
  return {
    unitOfWork: new DrizzleContentUnitOfWork(pool),
    // Outside any transaction: they see only what `run` committed.
    profile: profile(),
    experienceItems: experienceItems(),
    projects: projects(),
    posts: posts(),
    skills: skills(),
    cvBullets: cvBullets(),
    knowledgeEntries: knowledgeEntries(),
  };
});

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

describe("the profile singleton on Postgres", () => {
  it("keeps one row when two runs create a profile at once: the loser is a conflict", async () => {
    await emptyProfile();
    const first = newProfile();
    saveProfileRevision(first, "es");
    const second = newProfile();
    saveProfileRevision(second, "es");
    const unitOfWork = new DrizzleContentUnitOfWork(pool);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markSaved: () => void = () => {};
    const saved = new Promise<void>((resolve) => {
      markSaved = resolve;
    });
    const a = unitOfWork.run(async (scope) => {
      await scope.profile.save(first, 0);
      markSaved();
      await gate;
    });
    await saved;
    // Its INSERT waits on the uncommitted row in `profile_singleton`, then inserts nothing.
    const b = unitOfWork.run((scope) => scope.profile.save(second, 0));
    release();
    await a;
    await expect(b).rejects.toBeInstanceOf(ConcurrentModification);
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM content.profile");
    expect(rows).toEqual([{ id: first.id }]);
  });
});

describe("CV bullet parents on Postgres", () => {
  it("refuses a bullet whose parent does not exist with the foreign key's error", async () => {
    const orphan = newCvBullet({ kind: "project", projectId: newProject().id });
    await expect(cvBullets().save(orphan, 0)).rejects.toMatchObject({
      cause: { code: "23503", constraint: "cv_bullets_project_fk" },
    });
    const { rows } = await pool.query("SELECT id FROM content.cv_bullets WHERE id = $1", [
      orphan.id,
    ]);
    expect(rows).toEqual([]);
  });

  it("never writes the parent columns in an update", async () => {
    const item = newExperienceItem();
    await experienceItems().save(item, 0);
    const project = newProject();
    await projects().save(project, 0);
    const bullet = newCvBullet({ kind: "experience-item", experienceItemId: item.id });
    await cvBullets().save(bullet, 0);
    const loaded = (await cvBullets().get(bullet.id)) as CvBullet;
    const moved = CvBullet.reconstitute({
      ...loaded.snapshot(),
      parent: { kind: "project", projectId: project.id },
      sortOrder: 5,
    });
    await cvBullets().save(moved, 1);
    const { rows } = await pool.query(
      `SELECT experience_item_id, project_id, sort_order, version
       FROM content.cv_bullets WHERE id = $1`,
      [bullet.id],
    );
    expect(rows).toEqual([
      { experience_item_id: item.id, project_id: null, sort_order: 5, version: 2 },
    ]);
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

  it("refuses a post's published slug that differs from its published revision's slug", async () => {
    const post = newPost();
    savePostRevision(post, "es");
    savePostRevision(post, "en");
    post.publish(["es", "en"], at(3));
    await posts().save(post, 0);
    expect((await posts().get(post.id)) as Post).toBeDefined();
    await pool.query(
      `UPDATE content.post_translations SET published_slug = $2
       WHERE post_id = $1 AND locale = 'en'`,
      [post.id, `elsewhere-${post.id.slice(0, 8)}`],
    );
    await expect(posts().get(post.id)).rejects.toThrow(/published slug differs/);
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
