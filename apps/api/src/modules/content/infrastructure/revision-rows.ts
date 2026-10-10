import { z } from "zod";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { LOCALES, type Locale } from "../domain/locale.js";
import type { LocaleSnapshot, LocalizedRevisionsSnapshot } from "../domain/localized-revisions.js";
import { Revision } from "../domain/revision.js";
import { REVISION_ORIGINS } from "./content.schema.js";

// The mapper every content repository shares (Q1 B): revision rows and translation rows to and from
// the domain's snapshots, for both adapters, so the Drizzle repository and the in-memory fake store
// exactly the same rows and read them back through the same checks. A type adds only its document
// schema and its root row (`project-rows.ts`, `post-rows.ts`, `knowledge-entry-rows.ts`, ...).

/** A row of a `*_revisions` table built by `revisionTable`, as both adapters store it. */
export interface RevisionRow {
  readonly id: string;
  readonly itemId: string;
  readonly locale: string;
  readonly number: number;
  /** The `jsonb` document: unknown until the type's schema parses it. */
  readonly document: unknown;
  readonly origin: string;
  readonly createdAt: Date;
}

/** A row of a `*_translations` table built by `translationTable`: one locale's pointers. */
export interface TranslationRow {
  readonly itemId: string;
  readonly locale: string;
  readonly latestRevisionId: string;
  readonly publishedRevisionId: string | null;
  readonly publishedAt: Date | null;
  readonly firstPublishedAt: Date | null;
}

/** The rows of a localized type's three tables that one save writes. */
export interface LocalizedItemRows<B, T extends TranslationRow = TranslationRow> {
  readonly base: B;
  /** Every locale's row, upserted. */
  readonly translations: readonly T[];
  /** Only the revisions saved since the item was loaded, inserted (append-only). */
  readonly revisions: readonly RevisionRow[];
}

/** A translation row of a slug-addressed type (projects, posts): plus the published slug. */
export interface SlugTranslationRow extends TranslationRow {
  readonly publishedSlug: string | null;
}

const localeSchema = z.enum(LOCALES);
const originSchema = z.enum(REVISION_ORIGINS);

/**
 * Parses a stored value with its schema (the tolerant reader of Q1 B: unknown keys are dropped,
 * defaults fill fields added later). A value that does not parse is a corrupt row or a breaking
 * change to a stored shape, never a caller's mistake.
 * @param schema the Zod schema of the stored shape.
 * @param value the value read from a row.
 * @param itemId the item the row belongs to, for the error.
 * @param what what the value is (`revision <id> document`), for the error.
 * @returns the parsed value.
 * @throws {StoredStateInvalid} naming only the failing paths, never the stored values (they can be
 * private text).
 */
export function readStored<T>(
  schema: z.ZodType<T>,
  value: unknown,
  itemId: string,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)");
  throw new StoredStateInvalid(itemId, `${what} does not match its schema at ${paths.join(", ")}`);
}

/**
 * The row of a new revision. The document passes the type's schema on the way in too, so a shape
 * the read side would refuse never reaches the table.
 * @param revision a revision from the aggregate's `unsavedRevisions()`.
 * @param documentSchema the type's document schema.
 * @returns the row to insert.
 */
export function revisionRow<TDoc extends object, TProv extends object | null>(
  revision: Revision<TDoc, TProv>,
  documentSchema: z.ZodType<TDoc>,
): RevisionRow {
  return {
    id: revision.id,
    itemId: revision.itemId,
    locale: revision.locale,
    number: revision.number,
    document: documentSchema.parse(revision.document),
    origin: revision.origin,
    createdAt: revision.createdAt,
  };
}

/**
 * Rebuilds a stored revision: its locale, origin and document parsed, its provenance given.
 * @param row the stored row (an entry's row gets `locale: en` from its mapper: no locale column).
 * @param documentSchema the type's document schema.
 * @param provenance the revision's private data, already read, or null for a type that has none.
 * @returns the frozen revision.
 * @throws {StoredStateInvalid} when the locale, the origin or the document does not parse.
 */
export function revisionFromRow<TDoc extends object, TProv extends object | null>(
  row: RevisionRow,
  documentSchema: z.ZodType<TDoc>,
  provenance: TProv,
): Revision<TDoc, TProv> {
  const what = `revision ${row.id}`;
  return Revision.reconstitute<TDoc, TProv>({
    id: row.id,
    itemId: row.itemId,
    locale: readStored(localeSchema, row.locale, row.itemId, `${what} locale`),
    number: row.number,
    origin: readStored(originSchema, row.origin, row.itemId, `${what} origin`),
    document: readStored(documentSchema, row.document, row.itemId, `${what} document`),
    provenance,
    createdAt: row.createdAt,
  });
}

/**
 * The translation rows of an item: one per locale that has revisions, its pointers as the domain
 * holds them, plus the columns only some types have (`published_slug`).
 * @param itemId the item's id.
 * @param snapshot the item's per-locale snapshot.
 * @param extra the type's extra columns of one locale; `() => ({})` when it has none.
 * @returns the rows, in the order es, en, de.
 */
export function translationRows<TDoc extends object, TExtra extends object>(
  itemId: string,
  snapshot: LocalizedRevisionsSnapshot<TDoc>,
  extra: (locale: LocaleSnapshot<TDoc>) => TExtra,
): (TranslationRow & TExtra)[] {
  return LOCALES.flatMap((locale) => {
    const stored = snapshot.locales[locale];
    if (!stored) return [];
    return [
      {
        itemId,
        locale,
        latestRevisionId: stored.latest.id,
        publishedRevisionId: stored.published?.id ?? null,
        publishedAt: stored.publishedAt,
        firstPublishedAt: stored.firstPublishedAt,
        ...extra(stored),
      },
    ];
  });
}

/**
 * The translation rows and the new revision rows of a localized item: what every localized type's
 * mapper writes besides its root row.
 * @param itemId the item's id.
 * @param snapshot the item's per-locale snapshot.
 * @param unsaved the aggregate's `unsavedRevisions()`.
 * @param documentSchema the type's document schema, which every new document passes on the way in.
 * @param extra the type's extra columns of one locale (`publishedSlugOf`); none by default.
 * @returns the rows to upsert and to insert.
 */
export function localizedRows<TDoc extends object, TExtra extends object = Record<never, never>>(
  itemId: string,
  snapshot: LocalizedRevisionsSnapshot<TDoc>,
  unsaved: readonly Revision<TDoc>[],
  documentSchema: z.ZodType<TDoc>,
  extra: (locale: LocaleSnapshot<TDoc>) => TExtra = () => ({}) as TExtra,
): Pick<LocalizedItemRows<unknown, TranslationRow & TExtra>, "translations" | "revisions"> {
  return {
    translations: translationRows(itemId, snapshot, extra),
    revisions: unsaved.map((revision) => revisionRow(revision, documentSchema)),
  };
}

/**
 * The published slug of one locale of a slug-addressed type, copied from its published revision's
 * document, so `(locale, published_slug)` finds the page (D3).
 * @param locale one locale's snapshot.
 * @returns the extra translation column.
 */
export function publishedSlugOf<TDoc extends { readonly slug: string }>(
  locale: LocaleSnapshot<TDoc>,
): Pick<SlugTranslationRow, "publishedSlug"> {
  return { publishedSlug: locale.published?.document.slug ?? null };
}

/**
 * The rule the database cannot prove for a slug-addressed type: each locale's published slug is
 * its published revision's slug (a mapper bug would otherwise route a URL to another text).
 * @param itemId the item's id, for the error.
 * @returns the `check` that `localizedSnapshot` runs on every translation row.
 */
export function publishedSlugRule<TDoc extends { readonly slug: string }>(
  itemId: string,
): (row: SlugTranslationRow, locale: LocaleSnapshot<TDoc>) => void {
  return (row, locale) => {
    if (row.publishedSlug !== (locale.published?.document.slug ?? null)) {
      throw new StoredStateInvalid(
        itemId,
        `its ${row.locale} published slug differs from its published revision's slug`,
      );
    }
  };
}

/**
 * The ids of the revisions an item's translation rows point at: what a repository loads (the
 * latest and the published revision of each locale, D1), never the whole history.
 * @param rows the item's translation rows.
 * @returns each id once.
 */
export function pointedRevisionIds(rows: readonly TranslationRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.latestRevisionId);
    if (row.publishedRevisionId) ids.add(row.publishedRevisionId);
  }
  return [...ids];
}

/**
 * Rebuilds an item's per-locale snapshot from its translation rows and the revisions they point
 * at, checking what the database cannot: every pointed revision was loaded and parses, and the
 * type's own rule on a locale's row (`check`, such as the published slug).
 * @param itemId the item's id.
 * @param rows its translation rows.
 * @param revisions at least the revisions the rows point at.
 * @param documentSchema the type's document schema.
 * @param archivedAt the root's archive mark.
 * @param check the type's rule on one row and the locale built from it; throws `StoredStateInvalid`.
 * @returns the snapshot `reconstitute` takes.
 * @throws {StoredStateInvalid} when a row's locale, a pointed revision or the type's rule fails.
 */
export function localizedSnapshot<TDoc extends object, TRow extends TranslationRow>(
  itemId: string,
  rows: readonly TRow[],
  revisions: readonly RevisionRow[],
  documentSchema: z.ZodType<TDoc>,
  archivedAt: Date | null,
  check: (row: TRow, locale: LocaleSnapshot<TDoc>) => void = () => {},
): LocalizedRevisionsSnapshot<TDoc> {
  const byId = new Map(revisions.map((row) => [row.id, row]));
  const revision = (id: string, locale: Locale): Revision<TDoc> => {
    const row = byId.get(id);
    if (!row) throw new StoredStateInvalid(itemId, `its ${locale} revision ${id} was not loaded`);
    return revisionFromRow(row, documentSchema, null);
  };
  const locales: Partial<Record<Locale, LocaleSnapshot<TDoc>>> = {};
  for (const row of rows) {
    const locale = readStored(localeSchema, row.locale, itemId, "translation locale");
    const stored: LocaleSnapshot<TDoc> = {
      latest: revision(row.latestRevisionId, locale),
      published: row.publishedRevisionId ? revision(row.publishedRevisionId, locale) : null,
      publishedAt: row.publishedAt,
      firstPublishedAt: row.firstPublishedAt,
    };
    check(row, stored);
    locales[locale] = stored;
  }
  return { locales, archivedAt };
}
