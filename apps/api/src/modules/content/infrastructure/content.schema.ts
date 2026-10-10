import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { LOCALES } from "../domain/locale.js";
import type { ProjectKind } from "../domain/project.js";
import type { RevisionOrigin } from "../domain/revision.js";

// The content module's tables (WP-12 step 5, Q1 B), in the Postgres schema `content`. Only this
// module's infrastructure/ reads them: never exported from the module's index.ts. Every localized
// type has three tables: a base row with identity and layout (changed without a revision), one
// `*_revisions` table of immutable jsonb documents (one shape, one factory), and one
// `*_translations` row per locale holding the latest and published pointers (D2, D3). Constraint
// names are written out, because the generated ones pass Postgres's 63-character limit.

/**
 * The `content` Postgres schema. Exported because drizzle-kit writes `CREATE SCHEMA` only for a
 * schema value it finds among a config's exports.
 */
export const content = pgSchema("content");

/** Who wrote a revision (Q3 A), as stored in every revision table's `origin`. */
export const REVISION_ORIGINS = ["owner", "machine"] as const satisfies readonly RevisionOrigin[];

/** The project kinds (ADR-011), as stored in `projects.kind`. */
const PROJECT_KINDS = ["case_study", "project", "early"] as const satisfies readonly ProjectKind[];

/**
 * A CHECK that a text column holds one of a closed list of code constants (never user input, so
 * inlining them is safe).
 * @param column the column checked.
 * @param values the allowed values.
 * @returns the condition for `check()`.
 */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

/**
 * Builds the revision table of one localized type (Q1 B): every type has the same shape, an
 * immutable snapshot of one locale's full item as a `jsonb` document, numbered per item and locale.
 * The unique `(item, locale, id)` exists to be the target of the translation pointers' composite
 * foreign keys, which is how the database proves a pointer names a revision of the same item and
 * locale. `created_at` has no default: the domain's clock sets it (stored in epoch milliseconds,
 * which `timestamptz` keeps exactly).
 * @param name the table name, `<item>_revisions`.
 * @param itemId the item id column, named `<item>_id`, of the same type as the base table's id.
 * @param item the base table's id column.
 * @returns the table.
 */
export function revisionTable<TName extends string, TItemId extends PgColumnBuilderBase>(
  name: TName,
  itemId: TItemId,
  item: AnyPgColumn,
) {
  return content.table(
    name,
    {
      /** UUIDv7 from the `IdGenerator` port. */
      id: uuid().primaryKey(),
      itemId,
      locale: text().notNull(),
      number: integer().notNull(),
      document: jsonb().notNull(),
      origin: text().notNull(),
      createdAt: timestamp({ withTimezone: true }).notNull(),
    },
    (t) => [
      foreignKey({ name: `${name}_item_fk`, columns: [t.itemId], foreignColumns: [item] }),
      unique(`${name}_number_unique`).on(t.itemId, t.locale, t.number),
      unique(`${name}_pointer_target`).on(t.itemId, t.locale, t.id),
      check(`${name}_locale_check`, oneOf(t.locale, LOCALES)),
      check(`${name}_origin_check`, oneOf(t.origin, REVISION_ORIGINS)),
      check(`${name}_number_check`, sql`${t.number} >= 1`),
    ],
  );
}

/**
 * A translation table's columns as its extra constraints see them: the shared ones by name, and the
 * extra ones a type adds (`publishedSlug`) by key.
 */
type TranslationColumns<TExtraKey extends string = never> = Readonly<
  Record<"itemId" | "locale" | "publishedRevisionId" | "firstPublishedAt" | TExtraKey, AnyPgColumn>
>;

/** The columns of a revision table a translation's pointers reference. */
interface RevisionPointerTarget {
  readonly id: AnyPgColumn;
  readonly itemId: AnyPgColumn;
  readonly locale: AnyPgColumn;
}

/**
 * Builds the translation table of one localized type (D3): one row per item and locale, created
 * with the locale's first revision, so `latest_revision_id` is never null ("missing" is no row).
 * Both pointers are composite foreign keys to `(item, locale, id)` of the revision table; a null
 * published pointer is not checked (MATCH SIMPLE), and the three publish columns are set together.
 * Projects and posts add a `published_slug` with their own constraints through `extra`.
 * @param name the table name, `<item>_translations`.
 * @param itemId the item id column, named `<item>_id`, of the same type as the base table's id.
 * @param item the base table's id column.
 * @param revisions the type's revision table.
 * @param extra columns only some types have (`publishedSlug`).
 * @param extraConstraints constraints on those columns.
 * @returns the table.
 */
export function translationTable<
  TName extends string,
  TItemId extends PgColumnBuilderBase,
  TExtra extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  itemId: TItemId,
  item: AnyPgColumn,
  revisions: RevisionPointerTarget,
  extra: TExtra,
  extraConstraints: (
    t: TranslationColumns<keyof TExtra & string>,
  ) => PgTableExtraConfigValue[] = () => [],
) {
  return content.table(
    name,
    {
      itemId,
      locale: text().notNull(),
      latestRevisionId: uuid().notNull(),
      publishedRevisionId: uuid(),
      /** When the published pointer last moved (a publish or a rollback). */
      publishedAt: timestamp({ withTimezone: true }),
      /**
       * When the locale was first published; orders the posts feed (step 3 follow-ups). Written
       * only from the domain clock (a JS `Date`, millisecond precision), never by SQL `now()`:
       * the feed cursor carries milliseconds, so a microsecond value would repeat its row on the
       * next page.
       */
      firstPublishedAt: timestamp({ withTimezone: true }),
      ...extra,
    },
    (t) => [
      primaryKey({ name: `${name}_pkey`, columns: [t.itemId, t.locale] }),
      foreignKey({ name: `${name}_item_fk`, columns: [t.itemId], foreignColumns: [item] }),
      foreignKey({
        name: `${name}_latest_fk`,
        columns: [t.itemId, t.locale, t.latestRevisionId],
        foreignColumns: [revisions.itemId, revisions.locale, revisions.id],
      }),
      foreignKey({
        name: `${name}_published_fk`,
        columns: [t.itemId, t.locale, t.publishedRevisionId],
        foreignColumns: [revisions.itemId, revisions.locale, revisions.id],
      }),
      check(`${name}_locale_check`, oneOf(t.locale, LOCALES)),
      check(
        `${name}_published_check`,
        sql`num_nulls(${t.publishedRevisionId}, ${t.publishedAt}, ${t.firstPublishedAt}) IN (0, 3)`,
      ),
      // The factory cannot name a type's extra columns, so its constraints see them by key.
      ...extraConstraints(t as unknown as TranslationColumns<keyof TExtra & string>),
    ],
  );
}

/**
 * The extra column and constraints of a slug-addressed type (projects, posts): the localized slug
 * of the published revision, copied at publish so a page is found by `(locale, published_slug)`,
 * unique per locale, and set exactly when a revision is published. An archived item keeps its
 * pointers (restore needs no data change), so its published slugs stay taken.
 */
const publishedSlug = {
  columns: { publishedSlug: text() },
  constraints: (name: string) => (t: TranslationColumns<"publishedSlug">) => [
    unique(`${name}_slug_unique`).on(t.locale, t.publishedSlug),
    check(
      `${name}_slug_check`,
      sql`(${t.publishedSlug} IS NULL) = (${t.publishedRevisionId} IS NULL)`,
    ),
  ],
};

/** The optimistic concurrency column of every aggregate root (D5). */
const version = () => integer().notNull();

/** When the item was archived (hides every locale, keeps every pointer), or null. */
const archivedAt = () => timestamp({ withTimezone: true });

/**
 * The owner's profile, a singleton: the unique index on a constant allows one row at most. It has
 * no archive (a singleton with no restore would lock itself), so no `archived_at`.
 */
export const profile = content.table(
  "profile",
  { id: uuid().primaryKey(), version: version() },
  () => [uniqueIndex("profile_singleton").on(sql`(true)`)],
);

export const profileRevisions = revisionTable(
  "profile_revisions",
  uuid("profile_id").notNull(),
  profile.id,
);

export const profileTranslations = translationTable(
  "profile_translations",
  uuid("profile_id").notNull(),
  profile.id,
  profileRevisions,
  {},
);

/** One row per experience item. */
export const experienceItems = content.table("experience_items", {
  id: uuid().primaryKey(),
  sortOrder: integer().notNull(),
  archivedAt: archivedAt(),
  version: version(),
});

export const experienceItemRevisions = revisionTable(
  "experience_item_revisions",
  uuid("experience_item_id").notNull(),
  experienceItems.id,
);

export const experienceItemTranslations = translationTable(
  "experience_item_translations",
  uuid("experience_item_id").notNull(),
  experienceItems.id,
  experienceItemRevisions,
  {},
);

/** One row per project; `slug` is the canonical slug, stable, for admin routes and events. */
export const projects = content.table(
  "projects",
  {
    id: uuid().primaryKey(),
    slug: text().notNull(),
    kind: text().notNull(),
    featured: boolean().notNull(),
    sortOrder: integer().notNull(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique("projects_slug_unique").on(t.slug),
    check("projects_kind_check", oneOf(t.kind, PROJECT_KINDS)),
  ],
);

export const projectRevisions = revisionTable(
  "project_revisions",
  uuid("project_id").notNull(),
  projects.id,
);

export const projectTranslations = translationTable(
  "project_translations",
  uuid("project_id").notNull(),
  projects.id,
  projectRevisions,
  publishedSlug.columns,
  publishedSlug.constraints("project_translations"),
);

/** One row per post; `slug` is the canonical slug. */
export const posts = content.table(
  "posts",
  {
    id: uuid().primaryKey(),
    slug: text().notNull(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique("posts_slug_unique").on(t.slug)],
);

export const postRevisions = revisionTable("post_revisions", uuid("post_id").notNull(), posts.id);

/**
 * The posts feed is a keyset page on `(first_published_at, post_id)` newest first, per locale
 * (WP-12 step 7): the composite index serves it scanned backwards.
 */
export const postTranslations = translationTable(
  "post_translations",
  uuid("post_id").notNull(),
  posts.id,
  postRevisions,
  publishedSlug.columns,
  (t) => [
    ...publishedSlug.constraints("post_translations")(t),
    index("post_translations_feed_idx").on(t.locale, t.firstPublishedAt, t.itemId),
  ],
);

/** One row per skill. */
export const skills = content.table("skills", {
  id: uuid().primaryKey(),
  sortOrder: integer().notNull(),
  archivedAt: archivedAt(),
  version: version(),
});

export const skillRevisions = revisionTable(
  "skill_revisions",
  uuid("skill_id").notNull(),
  skills.id,
);

export const skillTranslations = translationTable(
  "skill_translations",
  uuid("skill_id").notNull(),
  skills.id,
  skillRevisions,
  {},
);

/**
 * One row per CV bullet, keyed by its human id (`backend-10`, ADR-031), never deleted so an id is
 * never reused: archiving is its tombstone. Its parent is an experience item or a project, never
 * both and never neither: two nullable foreign keys, so the database proves the parent exists, and
 * a CHECK that exactly one is set. The parent is fixed at creation by the domain; the repository
 * never updates these two columns.
 */
export const cvBullets = content.table(
  "cv_bullets",
  {
    id: text().primaryKey(),
    experienceItemId: uuid(),
    projectId: uuid(),
    sortOrder: integer().notNull(),
    importance: smallint().notNull(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    foreignKey({
      name: "cv_bullets_experience_item_fk",
      columns: [t.experienceItemId],
      foreignColumns: [experienceItems.id],
    }),
    foreignKey({
      name: "cv_bullets_project_fk",
      columns: [t.projectId],
      foreignColumns: [projects.id],
    }),
    check(
      "cv_bullets_one_parent_check",
      sql`num_nonnulls(${t.experienceItemId}, ${t.projectId}) = 1`,
    ),
    check("cv_bullets_importance_check", sql`${t.importance} BETWEEN 1 AND 3`),
    // The experience page lists each item's bullets; the project page each project's.
    index("cv_bullets_experience_item_idx").on(t.experienceItemId),
    index("cv_bullets_project_idx").on(t.projectId),
  ],
);

export const cvBulletRevisions = revisionTable(
  "cv_bullet_revisions",
  text("cv_bullet_id").notNull(),
  cvBullets.id,
);

export const cvBulletTranslations = translationTable(
  "cv_bullet_translations",
  text("cv_bullet_id").notNull(),
  cvBullets.id,
  cvBulletRevisions,
  {},
);
