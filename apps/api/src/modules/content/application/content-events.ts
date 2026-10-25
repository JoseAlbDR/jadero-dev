import type {
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
} from "@jadero/contracts";
import type { z } from "zod";
import type { CvBullet } from "../domain/cv-bullet.js";
import type { ExperienceItem } from "../domain/experience-item.js";
import { KNOWLEDGE_ENTRY_LOCALE, type KnowledgeEntry } from "../domain/knowledge-entry.js";
import { LOCALES, type Locale } from "../domain/locale.js";
import type { LocalizedRevisionsView } from "../domain/localized-revisions.js";
import type { Now } from "../domain/now.js";
import type { Post } from "../domain/post.js";
import type { Profile } from "../domain/profile.js";
import type { Project } from "../domain/project.js";
import type { Skill } from "../domain/skill.js";

// From the domain's result to the data of the content module's integration events (WP-14 D1):
// the use case emits them explicitly, the aggregates hold no domain events. Every document is built
// field by field from the published revision, naming exactly the fields of the public read DTO the
// contract picks (ADR-031, D2), the same allowlist the read side applies: a field the domain adds
// later, or a private one, cannot reach an event by accident.

/** The data of one `content.published.v1`. */
export type ContentPublishedData = z.input<typeof contentPublishedV1.data>;

/** The data of one `content.archived.v1`. */
export type ContentArchivedData = z.input<typeof contentArchivedV1.data>;

/** The data of one `knowledge.entry.approved.v1`. */
export type KnowledgeEntryApprovedData = z.input<typeof knowledgeEntryApprovedV1.data>;

/** The data of one `knowledge.entry.withdrawn.v1`. */
export type KnowledgeEntryWithdrawnData = z.input<typeof knowledgeEntryWithdrawnV1.data>;

type PublishedOf<A extends ContentPublishedData["aggregate"]> = Extract<
  ContentPublishedData,
  { aggregate: A }
>;

/**
 * How one localized type turns into events: the publish of one locale, and, for the archivable
 * types, the archive tombstone.
 */
export interface LocalizedEvents<TItem> {
  /**
   * The `content.published.v1` data of one locale whose published pointer just moved.
   * @param item the aggregate after the publish.
   * @param locale the locale that moved.
   * @returns the event data.
   * @throws Error when the locale has no published revision (a use case bug, never a user error).
   */
  published(item: TItem, locale: Locale): ContentPublishedData;
  /**
   * The `content.archived.v1` data of an item just archived, or undefined when no locale of it
   * was ever published: nothing public left, so there is nothing to announce (Q2 A).
   * @param item the aggregate after the archive.
   * @returns the event data, or undefined.
   */
  archived?(item: TItem): ContentArchivedData | undefined;
}

/** The fields every published event shares, and the document of the published revision. */
function publication<TDoc extends object>(
  id: string,
  view: LocalizedRevisionsView<TDoc>,
  locale: Locale,
) {
  const revision = view.published(locale);
  const at = view.publishedAt(locale);
  if (!revision || !at) throw new Error(`${id} has no published ${locale} revision to announce`);
  return {
    fields: {
      id,
      locale,
      revision: { id: revision.id, number: revision.number },
      publishedAt: at.toISOString(),
    },
    document: revision.document,
  };
}

/** Whether any locale of the item was published, the condition of an archive tombstone. */
function wasPublic<TDoc extends object>(view: LocalizedRevisionsView<TDoc>): boolean {
  return LOCALES.some((locale) => view.published(locale) !== null);
}

/** The id and the archive time, or undefined when the item never had a public locale. */
function archival<TDoc extends object>(
  id: string,
  view: LocalizedRevisionsView<TDoc>,
): { id: string; archivedAt: string } | undefined {
  const archivedAt = view.archivedAt();
  if (!archivedAt || !wasPublic(view)) return undefined;
  return { id, archivedAt: archivedAt.toISOString() };
}

/** The published localized slug per locale, the pages `web` tags by slug (step 2). */
function publishedSlugs(
  view: LocalizedRevisionsView<{ readonly slug: string }>,
): Partial<Record<Locale, string>> {
  const slugs: Partial<Record<Locale, string>> = {};
  for (const locale of LOCALES) {
    const revision = view.published(locale);
    if (revision) slugs[locale] = revision.document.slug;
  }
  return slugs;
}

/** The profile's events (a singleton: never archived). */
export const PROFILE_EVENTS: LocalizedEvents<Profile> = {
  published(profile, locale): PublishedOf<"profile"> {
    const { fields, document: d } = publication(profile.id, profile.translations, locale);
    return {
      aggregate: "profile",
      ...fields,
      item: {},
      document: {
        name: d.name,
        headline: d.headline,
        summary: d.summary,
        links: d.links.map((link) => ({ kind: link.kind, url: link.url })),
      },
    };
  },
};

/** The Now page's events (a singleton: never archived). */
export const NOW_EVENTS: LocalizedEvents<Now> = {
  published(now, locale): PublishedOf<"now"> {
    const { fields, document: d } = publication(now.id, now.translations, locale);
    return { aggregate: "now", ...fields, item: {}, document: { body: d.body } };
  },
};

/** An experience item's events. */
export const EXPERIENCE_ITEM_EVENTS: LocalizedEvents<ExperienceItem> = {
  published(item, locale): PublishedOf<"experience-item"> {
    const { fields, document: d } = publication(item.id, item.translations, locale);
    return {
      aggregate: "experience-item",
      ...fields,
      item: { sortOrder: item.sortOrder },
      document: {
        organization: d.organization,
        role: d.role,
        period: { from: d.period.from, to: d.period.to },
        locationType: d.locationType,
        stackTags: [...d.stackTags],
      },
    };
  },
  archived(item) {
    const base = archival(item.id, item.translations);
    return base && { aggregate: "experience-item", ...base };
  },
};

/** A project's events; the tombstone names the published slugs. */
export const PROJECT_EVENTS: LocalizedEvents<Project> = {
  published(project, locale): PublishedOf<"project"> {
    const { fields, document: d } = publication(project.id, project.translations, locale);
    return {
      aggregate: "project",
      ...fields,
      item: {
        slug: project.slug,
        kind: project.kind,
        featured: project.featured,
        sortOrder: project.sortOrder,
      },
      document: {
        slug: d.slug,
        title: d.title,
        summary: d.summary,
        body: d.body,
        stackTags: [...d.stackTags],
        repoUrl: d.repoUrl,
        demoUrl: d.demoUrl,
      },
    };
  },
  archived(project) {
    const base = archival(project.id, project.translations);
    return base && { aggregate: "project", ...base, slugs: publishedSlugs(project.translations) };
  },
};

/** A post's events; the tombstone names the published slugs. */
export const POST_EVENTS: LocalizedEvents<Post> = {
  published(post, locale): PublishedOf<"post"> {
    const { fields, document: d } = publication(post.id, post.translations, locale);
    return {
      aggregate: "post",
      ...fields,
      item: { slug: post.slug, kind: post.kind, wp: post.wp },
      document: {
        slug: d.slug,
        title: d.title,
        excerpt: d.excerpt,
        body: d.body,
        tags: [...d.tags],
      },
    };
  },
  archived(post) {
    const base = archival(post.id, post.translations);
    return base && { aggregate: "post", ...base, slugs: publishedSlugs(post.translations) };
  },
};

/** A skill's events. */
export const SKILL_EVENTS: LocalizedEvents<Skill> = {
  published(skill, locale): PublishedOf<"skill"> {
    const { fields, document: d } = publication(skill.id, skill.translations, locale);
    return {
      aggregate: "skill",
      ...fields,
      item: { sortOrder: skill.sortOrder },
      document: { name: d.name, category: d.category, projectSlugs: [...d.projectSlugs] },
    };
  },
  archived(skill) {
    const base = archival(skill.id, skill.translations);
    return base && { aggregate: "skill", ...base };
  },
};

/** A CV bullet's events. */
export const CV_BULLET_EVENTS: LocalizedEvents<CvBullet> = {
  published(bullet, locale): PublishedOf<"cv-bullet"> {
    const { fields, document: d } = publication(bullet.id, bullet.translations, locale);
    return {
      aggregate: "cv-bullet",
      ...fields,
      item: {
        parent:
          bullet.parent.kind === "project"
            ? { kind: "project", projectId: bullet.parent.projectId }
            : { kind: "experience-item", experienceItemId: bullet.parent.experienceItemId },
        sortOrder: bullet.sortOrder,
        importance: bullet.importance,
      },
      document: { text: d.text },
    };
  },
  archived(bullet) {
    const base = archival(bullet.id, bullet.translations);
    return base && { aggregate: "cv-bullet", ...base };
  },
};

/**
 * The `knowledge.entry.approved.v1` data of an entry just approved: the approved revision's public
 * document and its `confidence`, the one provenance field that leaves `api` (D-67). `sources`,
 * `conflicts` and `publicNames` are never read here (ADR-031).
 * @param entry the entry after the approval.
 * @returns the event data.
 * @throws Error when the entry has no approval or its revision is not loaded (a use case bug).
 */
export function knowledgeEntryApproved(entry: KnowledgeEntry): KnowledgeEntryApprovedData {
  const approval = entry.approval;
  const revision = approval && entry.revision(approval.revisionId);
  if (!approval || !revision) throw new Error(`${entry.id} has no approval to announce`);
  const d = revision.document;
  return {
    entryId: entry.id,
    locale: KNOWLEDGE_ENTRY_LOCALE,
    revision: { id: revision.id, number: revision.number },
    approval: { state: "approved", approvedAt: approval.approvedAt.toISOString() },
    document: {
      title: d.title,
      type: d.type,
      domain: d.domain,
      period: { from: d.period.from, to: d.period.to },
      role: d.role,
      stack: [...d.stack],
      patterns: [...d.patterns],
      indexable: d.indexable,
      cvBullet: d.cvBullet,
      related: [...d.related],
      sections: d.sections.map((section) => ({ key: section.key, body: section.body })),
      questions: [...d.questions],
    },
    confidence: revision.provenance.confidence,
  };
}

/**
 * The `knowledge.entry.withdrawn.v1` tombstone of an entry: no document, only what a read model
 * needs to drop it.
 * @param entryId the entry's id.
 * @param reason `withdrawn` (may come back with a new approval) or `deleted` (final).
 * @param at when it happened, from the use case's clock.
 * @returns the event data.
 */
export function knowledgeEntryWithdrawn(
  entryId: string,
  reason: KnowledgeEntryWithdrawnData["reason"],
  at: Date,
): KnowledgeEntryWithdrawnData {
  return { entryId, locale: KNOWLEDGE_ENTRY_LOCALE, reason, at: at.toISOString() };
}
