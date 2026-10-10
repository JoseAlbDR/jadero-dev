import type {
  Alternates,
  ExperienceItemDto,
  ExperienceListDto,
  KnowledgeEntryDto,
  KnowledgeEntryListDto,
  KnowledgeEntrySummaryDto,
  Locale,
  PostCursorPosition,
  PostDto,
  PostPageDto,
  PostSummaryDto,
  ProfileDto,
  ProjectDto,
  ProjectKind,
  ProjectListDto,
  ProjectSummaryDto,
  SkillListDto,
} from "@jadero/contracts";
import { encodePostCursor } from "@jadero/contracts";
import type { Database } from "@jadero/platform-nest";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  cvBulletDocumentSchema,
  experienceItemDocumentSchema,
  knowledgeEntryDocumentSchema,
  localeSchema,
  postDocumentSchema,
  profileDocumentSchema,
  projectDocumentSchema,
  projectKindSchema,
  skillDocumentSchema,
} from "../application/content-documents.js";
import { ContentQueries, POSTS_PAGE_SIZE } from "../application/content-queries.js";
import type { KnowledgeEntryDocument } from "../domain/knowledge-entry.js";
import { readStored } from "./revision-rows.js";

// The read side of the content module (CQRS): plain read-only SQL from the published pointers, run
// on the `content_reader` pool, which holds SELECT on exactly the tables below and nothing else
// (migration 0002_content_reader). Every row and `jsonb` document is parsed on the way in (the
// tolerant reader of Q1 B), and every DTO is built field by field, so a document field added later
// stays private until a contract and this mapper name it. The controllers' response schemas parse
// the result once more (D-67's second guard).

/** The locale a request for `locale` falls back to; only German falls back (D-20). */
const FALLBACK: Partial<Record<Locale, Locale>> = { de: "en" };

/**
 * The published translation a visitor of `locale` gets, as a condition on the alias `t` of a
 * translations table: a published row in the requested locale, or, for German only, the English row
 * of an item that has no published German row. Exactly one row per item matches, so lists need no
 * `DISTINCT` and a slug lookup finds the German slug first and the English slug only for items with
 * no German version.
 * @param translations the translations table, a code constant (never input).
 * @param itemId its item id column, a code constant.
 * @param locale the requested locale.
 * @returns the condition.
 */
function chosenTranslation(translations: string, itemId: string, locale: Locale): SQL {
  const published = sql`t.published_revision_id IS NOT NULL`;
  const fallback = FALLBACK[locale];
  if (fallback === undefined) return sql`${published} AND t.locale = ${locale}`;
  return sql`${published} AND (t.locale = ${locale} OR (t.locale = ${fallback} AND NOT EXISTS (
    SELECT FROM ${sql.raw(translations)} d
    WHERE d.${sql.raw(itemId)} = t.${sql.raw(itemId)} AND d.locale = ${locale}
      AND d.published_revision_id IS NOT NULL)))`;
}

/**
 * The published localized slug per locale of the item of row `t`, for `hreflang` (WP-16).
 * @param translations the translations table of a slug-addressed type, a code constant.
 * @param itemId its item id column, a code constant.
 * @returns a `jsonb` object expression, `{ "es": "...", "en": "..." }`.
 */
function alternatesOf(translations: string, itemId: string): SQL {
  return sql`(SELECT jsonb_object_agg(a.locale, a.published_slug) FROM ${sql.raw(translations)} a
    WHERE a.${sql.raw(itemId)} = t.${sql.raw(itemId)} AND a.published_slug IS NOT NULL)`;
}

const alternatesRow = z.partialRecord(localeSchema, z.string());

const profileRow = z.object({ id: z.string(), locale: localeSchema, document: z.unknown() });

const experienceRow = z.object({
  id: z.string(),
  locale: localeSchema,
  document: z.unknown(),
  bullet_id: z.string().nullable(),
  bullet_document: z.unknown(),
  entry_ids: z.array(z.string()),
});

const projectRow = z.object({
  id: z.string(),
  locale: localeSchema,
  slug: z.string(),
  kind: projectKindSchema,
  featured: z.boolean(),
  document: z.unknown(),
  alternates: alternatesRow,
});

const postRow = z.object({
  id: z.string(),
  locale: localeSchema,
  slug: z.string(),
  first_published_at: z.iso.datetime(),
  document: z.unknown(),
  alternates: alternatesRow,
});

const skillRow = z.object({ id: z.string(), locale: localeSchema, document: z.unknown() });

const entryRow = z.object({ id: z.string(), document: z.unknown() });

/**
 * The {@link ContentQueries} adapter on Drizzle over the read-only pool. Queries only: no
 * transaction, no write, no table outside the grants of `content_reader`.
 */
export class DrizzleContentQueries extends ContentQueries {
  /** @param db Drizzle over the `content_reader` pool. */
  constructor(private readonly db: Database) {
    super();
  }

  /**
   * Runs one query and parses every row with its schema.
   * @param schema the row's shape.
   * @param query the statement.
   * @returns the parsed rows.
   */
  private async rows<T>(schema: z.ZodType<T>, query: SQL): Promise<T[]> {
    const result = await this.db.execute(query);
    return result.rows.map((row, index) => readStored(schema, row, `row ${index}`, "query row"));
  }

  /** {@inheritDoc ContentQueries.profile} */
  async profile(locale: Locale): Promise<ProfileDto | undefined> {
    const [row] = await this.rows(
      profileRow,
      sql`SELECT t.profile_id AS id, t.locale, r.document
        FROM content.profile_translations t
        JOIN content.profile_revisions r ON r.id = t.published_revision_id
        WHERE ${chosenTranslation("content.profile_translations", "profile_id", locale)}
        LIMIT 1`,
    );
    if (!row) return undefined;
    const doc = readStored(profileDocumentSchema, row.document, row.id, "profile document");
    return {
      locale: row.locale,
      name: doc.name,
      headline: doc.headline,
      summary: doc.summary,
      links: doc.links.map((link) => ({ kind: link.kind, url: link.url })),
    };
  }

  /** {@inheritDoc ContentQueries.experience} */
  async experience(locale: Locale): Promise<ExperienceListDto> {
    // One statement, so items and bullets come from one snapshot. A bullet shows in its item's
    // language only (the contract: "in its parent's language"); one not published there is left out.
    const rows = await this.rows(
      experienceRow,
      sql`WITH chosen AS (
          SELECT i.id, i.sort_order, t.locale, r.document
          FROM content.experience_item_translations t
          JOIN content.experience_items i ON i.id = t.experience_item_id
          JOIN content.experience_item_revisions r ON r.id = t.published_revision_id
          WHERE i.archived_at IS NULL
            AND ${chosenTranslation("content.experience_item_translations", "experience_item_id", locale)}
        )
        SELECT c.id, c.locale, c.document, b.id AS bullet_id, br.document AS bullet_document,
          ARRAY(SELECT e.id FROM content.knowledge_entries e
            WHERE e.cv_bullet = b.id AND e.approved_revision_id IS NOT NULL AND e.deleted_at IS NULL
            ORDER BY e.id) AS entry_ids
        FROM chosen c
        LEFT JOIN (content.cv_bullets b
          JOIN content.cv_bullet_translations bt
            ON bt.cv_bullet_id = b.id AND bt.published_revision_id IS NOT NULL
          JOIN content.cv_bullet_revisions br ON br.id = bt.published_revision_id)
          ON b.experience_item_id = c.id AND b.archived_at IS NULL AND bt.locale = c.locale
        ORDER BY c.sort_order, c.id, b.sort_order, b.id`,
    );
    const items = new Map<string, ExperienceItemDto>();
    for (const row of rows) {
      let item = items.get(row.id);
      if (!item) {
        const doc = readStored(experienceItemDocumentSchema, row.document, row.id, "document");
        item = {
          locale: row.locale,
          organization: doc.organization,
          role: doc.role,
          period: { from: doc.period.from, to: doc.period.to },
          locationType: doc.locationType,
          stackTags: [...doc.stackTags],
          bullets: [],
        };
        items.set(row.id, item);
      }
      if (row.bullet_id !== null) {
        const bullet = readStored(
          cvBulletDocumentSchema,
          row.bullet_document,
          row.bullet_id,
          "document",
        );
        item.bullets.push({ id: row.bullet_id, text: bullet.text, entryIds: row.entry_ids });
      }
    }
    return { items: [...items.values()] };
  }

  /** {@inheritDoc ContentQueries.projects} */
  async projects(locale: Locale, kind?: ProjectKind): Promise<ProjectListDto> {
    const rows = await this.rows(
      projectRow,
      sql`${this.projectSelect(locale)}
        ${kind === undefined ? sql`` : sql`AND p.kind = ${kind}`}
        ORDER BY p.sort_order, p.id`,
    );
    return { items: rows.map((row) => this.projectSummary(row)) };
  }

  /** {@inheritDoc ContentQueries.project} */
  async project(locale: Locale, slug: string): Promise<ProjectDto | undefined> {
    // Two rows can match on German: a German slug, and the same text as the English slug of
    // another project with no German version. The German one wins.
    const [row] = await this.rows(
      projectRow,
      sql`${this.projectSelect(locale)} AND t.published_slug = ${slug}
        ORDER BY t.locale = ${locale} DESC LIMIT 1`,
    );
    if (!row) return undefined;
    const doc = readStored(projectDocumentSchema, row.document, row.id, "document");
    return {
      ...this.projectSummary(row),
      body: doc.body,
      repoUrl: doc.repoUrl,
      demoUrl: doc.demoUrl,
    };
  }

  /** {@inheritDoc ContentQueries.posts} */
  async posts(locale: Locale, after?: PostCursorPosition): Promise<PostPageDto> {
    // Keyset pagination on (first_published_at, id), newest first: a republish (a typo fix) moves
    // `published_at` but not `first_published_at`, so it never moves a post to the top. One extra
    // row tells whether a next page exists.
    const rows = await this.rows(
      postRow,
      sql`${this.postSelect(locale)}
        ${
          after === undefined
            ? sql``
            : sql`AND (t.first_published_at, t.post_id) < (${after.publishedAt}::timestamptz, ${after.id}::uuid)`
        }
        ORDER BY t.first_published_at DESC, t.post_id DESC
        LIMIT ${POSTS_PAGE_SIZE + 1}`,
    );
    const page = rows.slice(0, POSTS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.postSummary(row)),
      nextCursor:
        rows.length > POSTS_PAGE_SIZE && last
          ? encodePostCursor({ publishedAt: last.first_published_at, id: last.id })
          : null,
    };
  }

  /** {@inheritDoc ContentQueries.post} */
  async post(locale: Locale, slug: string): Promise<PostDto | undefined> {
    const [row] = await this.rows(
      postRow,
      sql`${this.postSelect(locale)} AND t.published_slug = ${slug}
        ORDER BY t.locale = ${locale} DESC LIMIT 1`,
    );
    if (!row) return undefined;
    const doc = readStored(postDocumentSchema, row.document, row.id, "document");
    return { ...this.postSummary(row), body: doc.body };
  }

  /** {@inheritDoc ContentQueries.skills} */
  async skills(locale: Locale): Promise<SkillListDto> {
    const rows = await this.rows(
      skillRow,
      sql`SELECT s.id, t.locale, r.document
        FROM content.skill_translations t
        JOIN content.skills s ON s.id = t.skill_id
        JOIN content.skill_revisions r ON r.id = t.published_revision_id
        WHERE s.archived_at IS NULL
          AND ${chosenTranslation("content.skill_translations", "skill_id", locale)}
        ORDER BY s.sort_order, s.id`,
    );
    return {
      items: rows.map((row) => {
        const doc = readStored(skillDocumentSchema, row.document, row.id, "document");
        return {
          locale: row.locale,
          name: doc.name,
          category: doc.category,
          projectSlugs: [...doc.projectSlugs],
        };
      }),
    };
  }

  /** {@inheritDoc ContentQueries.workLog} */
  async workLog(): Promise<KnowledgeEntryListDto> {
    const rows = await this.rows(entryRow, sql`${this.entrySelect()} ORDER BY e.id`);
    return {
      items: rows.map((row) => {
        const doc = readStored(knowledgeEntryDocumentSchema, row.document, row.id, "document");
        return {
          ...entryMetadata(row.id, doc),
          summary: doc.sections.find((section) => section.key === "summary")?.body ?? "",
        };
      }),
    };
  }

  /** {@inheritDoc ContentQueries.workEntry} */
  async workEntry(entryId: string): Promise<KnowledgeEntryDto | undefined> {
    const [row] = await this.rows(entryRow, sql`${this.entrySelect()} AND e.id = ${entryId}`);
    if (!row) return undefined;
    const doc = readStored(knowledgeEntryDocumentSchema, row.document, row.id, "document");
    return {
      ...entryMetadata(row.id, doc),
      cvBullet: doc.cvBullet,
      related: [...doc.related],
      sections: doc.sections.map((section) => ({ key: section.key, body: section.body })),
      questions: [...doc.questions],
    };
  }

  /** The published, not archived projects in the chosen locale; callers add filters and order. */
  private projectSelect(locale: Locale): SQL {
    return sql`SELECT p.id, t.locale, t.published_slug AS slug, p.kind, p.featured, r.document,
        ${alternatesOf("content.project_translations", "project_id")} AS alternates
      FROM content.project_translations t
      JOIN content.projects p ON p.id = t.project_id
      JOIN content.project_revisions r ON r.id = t.published_revision_id
      WHERE p.archived_at IS NULL
        AND ${chosenTranslation("content.project_translations", "project_id", locale)}`;
  }

  /** The published, not archived posts in the chosen locale; callers add filters and order. */
  private postSelect(locale: Locale): SQL {
    // Drizzle's node-postgres driver returns timestamps from `execute` as Postgres text, so the
    // key is formatted here as ISO 8601 in UTC with milliseconds, the precision the domain clock
    // stores (epoch ms), which keeps the cursor exact. The rule this rests on: every write of
    // `first_published_at` comes from the domain clock, never SQL `now()` (microseconds), or a
    // row whose stored value is finer than its cursor would repeat on the next page.
    return sql`SELECT t.post_id AS id, t.locale, t.published_slug AS slug,
        to_char(t.first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          AS first_published_at,
        r.document, ${alternatesOf("content.post_translations", "post_id")} AS alternates
      FROM content.post_translations t
      JOIN content.posts p ON p.id = t.post_id
      JOIN content.post_revisions r ON r.id = t.published_revision_id
      WHERE p.archived_at IS NULL
        AND ${chosenTranslation("content.post_translations", "post_id", locale)}`;
  }

  /**
   * Approved, not deleted entries with their approved revision; callers add filters and order.
   * Never joins `knowledge_entry_provenance`, which `content_reader` cannot read anyway.
   */
  private entrySelect(): SQL {
    return sql`SELECT e.id, r.document
      FROM content.knowledge_entries e
      JOIN content.knowledge_entry_revisions r ON r.id = e.approved_revision_id
      WHERE e.deleted_at IS NULL`;
  }

  private projectSummary(row: z.infer<typeof projectRow>): ProjectSummaryDto {
    const doc = readStored(projectDocumentSchema, row.document, row.id, "document");
    return {
      slug: row.slug,
      locale: row.locale,
      kind: row.kind,
      title: doc.title,
      summary: doc.summary,
      stackTags: [...doc.stackTags],
      featured: row.featured,
      alternates: row.alternates satisfies Alternates,
    };
  }

  private postSummary(row: z.infer<typeof postRow>): PostSummaryDto {
    const doc = readStored(postDocumentSchema, row.document, row.id, "document");
    return {
      slug: row.slug,
      locale: row.locale,
      title: doc.title,
      excerpt: doc.excerpt,
      tags: [...doc.tags],
      // The date a post card shows is the date it first went public, the same key the feed is
      // ordered by, so the dates on a page always run newest first.
      publishedAt: row.first_published_at,
      alternates: row.alternates satisfies Alternates,
    };
  }
}

/**
 * The public front matter of an entry (D-67), named field by field.
 * @param id the entry id.
 * @param doc the approved revision's document.
 * @returns the metadata every entry DTO shares.
 */
function entryMetadata(
  id: string,
  doc: KnowledgeEntryDocument,
): Omit<KnowledgeEntrySummaryDto, "summary"> {
  return {
    id,
    title: doc.title,
    type: doc.type,
    domain: doc.domain,
    period: { from: doc.period.from, to: doc.period.to },
    role: doc.role,
    stack: [...doc.stack],
    patterns: [...doc.patterns],
    indexable: doc.indexable,
  };
}
