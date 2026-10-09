import type { Database } from "@jadero/platform-nest";
import { and, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ConcurrentModification } from "../domain/content.errors.js";
import { pointedRevisionIds, type RevisionRow, type TranslationRow } from "./revision-rows.js";

// The SQL every content repository shares: the compare-and-set on an aggregate's root row (D5) and
// the reads and writes of a localized type's revision and translation tables (Q1 B, D3). Each type's
// repository adds its root columns; step 5c's five types reuse both as they are.

/** Drizzle with any schema: the repositories use only the query builder. */
export type ContentDatabase = Database<Record<string, unknown>>;

type Columns<TKey extends string> = PgTable & { readonly [K in TKey]: AnyPgColumn };

/** A root table: an id and the optimistic concurrency version. */
export type VersionedTable = Columns<"id" | "version">;

/** A revision table built by `revisionTable`. */
export type RevisionTable = Columns<keyof RevisionRow & string>;

/** A translation table built by `translationTable`. */
export type TranslationTable = Columns<keyof TranslationRow & string>;

/**
 * Writes the root row only when it is still at `expectedVersion` (D5), as the first statement of a
 * save, so it also takes the row's lock: a second save of the same item in another transaction
 * waits here, then finds the new version and fails. `expectedVersion` 0 inserts the row at version 1
 * (`ON CONFLICT (id) DO NOTHING`, so a duplicate id is a conflict, not an aborted transaction);
 * otherwise `UPDATE ... SET <set>, version = expected + 1 WHERE id = $1 AND version = expected`.
 * @param db Drizzle on the unit of work's connection.
 * @param table the root table.
 * @param id the item's id.
 * @param expectedVersion the version the caller loaded, 0 for a new item.
 * @param insert every root column but `version`, for a create.
 * @param set the root columns an update changes, besides `version`.
 * @throws {ConcurrentModification} when no row was written.
 */
export async function compareAndSet(
  db: ContentDatabase,
  table: VersionedTable,
  id: string,
  expectedVersion: number,
  insert: Readonly<Record<string, unknown>>,
  set: Readonly<Record<string, unknown>>,
): Promise<void> {
  const version = expectedVersion + 1;
  const written =
    expectedVersion === 0
      ? await db
          .insert(table)
          .values({ ...insert, version })
          .onConflictDoNothing({ target: table.id })
          .returning({ id: table.id })
      : await db
          .update(table)
          .set({ ...set, version })
          .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
          .returning({ id: table.id });
  if (written.length === 0) throw new ConcurrentModification(id, expectedVersion);
}

/**
 * The revision and translation tables of one localized type, on one Drizzle instance. Revisions are
 * only ever inserted; translations are upserted per locale, after the revisions their composite
 * foreign keys point at.
 */
export class DrizzleLocalizedRows<TRow extends TranslationRow> {
  /**
   * @param db Drizzle on the pool (display reads) or on the unit of work's connection.
   * @param revisions the type's revision table.
   * @param translations the type's translation table.
   * @param extra the type's extra translation columns by key (`publishedSlug`), read and written.
   */
  constructor(
    private readonly db: ContentDatabase,
    private readonly revisions: RevisionTable,
    private readonly translations: TranslationTable,
    private readonly extra: Readonly<
      Record<Exclude<keyof TRow, keyof TranslationRow>, AnyPgColumn>
    >,
  ) {}

  /**
   * Reads an item's translation rows, then only the revisions they point at (D1).
   * @param itemId the item's id.
   * @returns the rows, for the type's mapper.
   */
  async load(itemId: string): Promise<{ translations: TRow[]; revisions: RevisionRow[] }> {
    const t = this.translations;
    // Drizzle sees the factory tables' columns as `AnyPgColumn` here, so it types the values as
    // unknown; the factories fix them to the row interfaces' types.
    const translations = (await this.db
      .select({
        itemId: t.itemId,
        locale: t.locale,
        latestRevisionId: t.latestRevisionId,
        publishedRevisionId: t.publishedRevisionId,
        publishedAt: t.publishedAt,
        firstPublishedAt: t.firstPublishedAt,
        ...this.extra,
      })
      .from(t)
      .where(eq(t.itemId, itemId))) as unknown as TRow[];
    const ids = pointedRevisionIds(translations);
    if (ids.length === 0) return { translations, revisions: [] };
    const r = this.revisions;
    const revisions = (await this.db
      .select({
        id: r.id,
        itemId: r.itemId,
        locale: r.locale,
        number: r.number,
        document: r.document,
        origin: r.origin,
        createdAt: r.createdAt,
      })
      .from(r)
      .where(and(eq(r.itemId, itemId), inArray(r.id, ids)))) as RevisionRow[];
    return { translations, revisions };
  }

  /**
   * Inserts new revisions in one statement; never updates one (append-only, D2).
   * @param rows the aggregate's unsaved revisions.
   */
  async insertRevisions(rows: readonly RevisionRow[]): Promise<void> {
    if (rows.length > 0)
      await this.db.insert(this.revisions).values(rows.map((row) => ({ ...row })));
  }

  /**
   * Upserts each locale's pointers: `INSERT ... ON CONFLICT (item, locale) DO UPDATE`.
   * @param rows every locale's row.
   */
  async upsertTranslations(rows: readonly TRow[]): Promise<void> {
    const t = this.translations;
    for (const row of rows) {
      const { itemId: _item, locale: _locale, ...pointers } = row;
      await this.db
        .insert(t)
        .values({ ...row })
        .onConflictDoUpdate({ target: [t.itemId, t.locale], set: pointers });
    }
  }
}
