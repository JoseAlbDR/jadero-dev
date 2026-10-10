import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-12 step 5: the guards the content schema adds, proved on the migrated database as the ordinary
// owner role (WP-10 D4), with plain SQL so no repository can hide a missing constraint. Each test
// writes its own items with fresh ids, so the tests share one database and need no cleanup.
let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createContentTestDatabase();
  drop = database.drop;
  await runMigrations({
    service: "api",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  client = new pg.Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await drop();
});

/** Runs one statement with its parameters. */
async function run(text: string, values: unknown[] = []): Promise<void> {
  await client.query(text, values);
}

/** The error a statement fails with, as Postgres reports it (SQLSTATE and constraint name). */
function rejection(code: string, constraint: string) {
  return expect.objectContaining({ code, constraint });
}

/** A project with no translation yet. */
async function project(): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO content.projects (id, slug, kind, featured, sort_order, version)
     VALUES ($1, $2, 'project', false, 1, 1)`,
    [id, `project-${id.slice(0, 8)}`],
  );
  return id;
}

/** Revision 1 of one locale of a project. */
async function projectRevision(projectId: string, locale: string): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO content.project_revisions (id, project_id, locale, number, document, origin, created_at)
     VALUES ($1, $2, $3, 1, '{"slug":"placeholder","title":"Placeholder"}', 'owner', now())`,
    [id, projectId, locale],
  );
  return id;
}

/** Inserts a translation row published at `published` with a published slug. */
function publishTranslation(
  projectId: string,
  locale: string,
  latest: string,
  published: string,
  slug: string,
): Promise<void> {
  return run(
    `INSERT INTO content.project_translations
       (project_id, locale, latest_revision_id, published_revision_id, published_at, first_published_at, published_slug)
     VALUES ($1, $2, $3, $4, now(), now(), $5)`,
    [projectId, locale, latest, published, slug],
  );
}

describe("translation pointers (composite foreign keys to the revision's item and locale)", () => {
  it("accept a published pointer to a revision of the same item and locale", async () => {
    const id = await project();
    const es = await projectRevision(id, "es");
    await expect(publishTranslation(id, "es", es, es, `ok-${id}`)).resolves.toBeUndefined();
  });

  it("refuse a published pointer to a revision of another locale of the same item", async () => {
    const id = await project();
    const es = await projectRevision(id, "es");
    const en = await projectRevision(id, "en");
    await expect(publishTranslation(id, "es", es, en, `x-${id}`)).rejects.toEqual(
      rejection("23503", "project_translations_published_fk"),
    );
  });

  it("refuse a published pointer to a revision of another item in the same locale", async () => {
    const id = await project();
    const other = await project();
    const es = await projectRevision(id, "es");
    const othersEs = await projectRevision(other, "es");
    await expect(publishTranslation(id, "es", es, othersEs, `x-${id}`)).rejects.toEqual(
      rejection("23503", "project_translations_published_fk"),
    );
  });

  it("refuse a published pointer without its publish time", async () => {
    const id = await project();
    const es = await projectRevision(id, "es");
    await expect(
      run(
        `INSERT INTO content.project_translations (project_id, locale, latest_revision_id, published_revision_id)
         VALUES ($1, 'es', $2, $2)`,
        [id, es],
      ),
    ).rejects.toEqual(rejection("23514", "project_translations_published_check"));
  });
});

describe("published slugs (unique per locale)", () => {
  it("refuse a second project publishing the same slug in the same locale", async () => {
    const first = await project();
    const second = await project();
    const slug = `same-${first}`;
    const firstEs = await projectRevision(first, "es");
    const secondEs = await projectRevision(second, "es");
    await publishTranslation(first, "es", firstEs, firstEs, slug);
    await expect(publishTranslation(second, "es", secondEs, secondEs, slug)).rejects.toEqual(
      rejection("23505", "project_translations_slug_unique"),
    );
  });

  it("accept the same slug in another locale", async () => {
    const first = await project();
    const second = await project();
    const slug = `same-${first}`;
    const firstEs = await projectRevision(first, "es");
    const secondEn = await projectRevision(second, "en");
    await publishTranslation(first, "es", firstEs, firstEs, slug);
    await expect(
      publishTranslation(second, "en", secondEn, secondEn, slug),
    ).resolves.toBeUndefined();
  });
});

describe("cv bullet parent (exactly one, and it exists)", () => {
  /** Inserts a bullet with the given parent columns. */
  function bullet(experienceItemId: string | null, projectId: string | null): Promise<void> {
    return run(
      `INSERT INTO content.cv_bullets (id, experience_item_id, project_id, sort_order, importance, version)
       VALUES ($1, $2, $3, 1, 1, 1)`,
      [`placeholder-${randomUUID().slice(0, 8)}`, experienceItemId, projectId],
    );
  }

  /** An experience item with no translation yet. */
  async function experienceItem(): Promise<string> {
    const id = randomUUID();
    await run("INSERT INTO content.experience_items (id, sort_order, version) VALUES ($1, 1, 1)", [
      id,
    ]);
    return id;
  }

  it("accept a bullet under one project", async () => {
    await expect(bullet(null, await project())).resolves.toBeUndefined();
  });

  it("refuse a bullet with no parent", async () => {
    await expect(bullet(null, null)).rejects.toEqual(
      rejection("23514", "cv_bullets_one_parent_check"),
    );
  });

  it("refuse a bullet with two parents", async () => {
    await expect(bullet(await experienceItem(), await project())).rejects.toEqual(
      rejection("23514", "cv_bullets_one_parent_check"),
    );
  });

  it("refuse a bullet whose parent does not exist", async () => {
    await expect(bullet(null, randomUUID())).rejects.toEqual(
      rejection("23503", "cv_bullets_project_fk"),
    );
  });
});

describe("knowledge entries", () => {
  /** An entry in draft with revision 1. */
  async function entry(): Promise<{ id: string; revisionId: string }> {
    const id = `kb-${randomUUID().slice(0, 8)}`;
    const revisionId = randomUUID();
    await run(
      "INSERT INTO content.knowledge_entries (id, state, version) VALUES ($1, 'draft', 1)",
      [id],
    );
    await run(
      `INSERT INTO content.knowledge_entry_revisions (id, entry_id, number, document, origin, created_at)
       VALUES ($1, $2, 1, '{"title":"Placeholder"}', 'owner', now())`,
      [revisionId, id],
    );
    return { id, revisionId };
  }

  /** Approves an entry at the given revision. */
  function approve(entryId: string, revisionId: string): Promise<void> {
    return run(
      `UPDATE content.knowledge_entries
       SET state = 'approved', approved_revision_id = $2, approved_at = now(), approval_checklist = '{}'
       WHERE id = $1`,
      [entryId, revisionId],
    );
  }

  it("accept an approval of the entry's own revision", async () => {
    const { id, revisionId } = await entry();
    await expect(approve(id, revisionId)).resolves.toBeUndefined();
  });

  it("refuse an approval pointing at another entry's revision", async () => {
    const { id } = await entry();
    const other = await entry();
    await expect(approve(id, other.revisionId)).rejects.toEqual(
      rejection("23503", "knowledge_entries_approved_fk"),
    );
  });

  it("refuse a provenance row for a revision that does not exist", async () => {
    await expect(
      run(
        `INSERT INTO content.knowledge_entry_provenance (revision_id, sources, conflicts, public_names, confidence)
         VALUES ($1, '{}', '', '{}', 'high')`,
        [randomUUID()],
      ),
    ).rejects.toEqual(rejection("23503", "knowledge_entry_provenance_revision_fk"));
  });

  it("accept a provenance row for an existing revision", async () => {
    const { revisionId } = await entry();
    await expect(
      run(
        `INSERT INTO content.knowledge_entry_provenance (revision_id, sources, conflicts, public_names, confidence)
         VALUES ($1, '{"placeholder notes"}', '', '{}', 'medium')`,
        [revisionId],
      ),
    ).resolves.toBeUndefined();
  });
});

describe("profile", () => {
  it("hold one row at most", async () => {
    await run("INSERT INTO content.profile (id, version) VALUES ($1, 1)", [randomUUID()]);
    await expect(
      run("INSERT INTO content.profile (id, version) VALUES ($1, 1)", [randomUUID()]),
    ).rejects.toEqual(rejection("23505", "profile_singleton"));
  });
});
