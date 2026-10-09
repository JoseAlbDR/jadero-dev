import { IdInvalid } from "./content.errors.js";
import { isCvBulletId, isFilled } from "./field-formats.js";
import type { Locale } from "./locale.js";
import {
  type DocumentRules,
  LocalizedRevisions,
  type LocalizedRevisionsSnapshot,
  type LocalizedRevisionsView,
  type PublishResult,
  type PublishTarget,
} from "./localized-revisions.js";
import type { Revision, RevisionOrigin } from "./revision.js";

/**
 * What a CV bullet details: exactly one experience item or one project (ADR-031 Layer A), referenced
 * by id (D1). The union makes "both" and "neither" unrepresentable; it is fixed at creation.
 */
export type CvBulletParent =
  | { readonly kind: "experience-item"; readonly experienceItemId: string }
  | { readonly kind: "project"; readonly projectId: string };

/** How much a bullet matters, 1 (most) to 3: decides what fits the PDF CV's page limit (ADR-031). */
export type CvBulletImportance = 1 | 2 | 3;

/** One locale of a CV bullet, the content of a revision (Q1 B): the line itself. */
export interface CvBulletDocument {
  readonly text: string;
}

/**
 * The rules of a CV bullet document. Format on save: nothing beyond the type (a bullet is one free
 * line). Complete for publish: what `cvBulletDto` requires, a text that is not blank.
 */
export const cvBulletRules: DocumentRules<CvBulletDocument> = {
  invalidFields: () => [],
  isComplete: (doc) => isFilled(doc.text),
};

/** The layout fields of a CV bullet, kept on the root and changed without a revision (Q1 B). */
export interface CvBulletLayout {
  /**
   * The human id (`backend-10`, ADR-031 alignment): the identity used in files, citations and the
   * "Ask about this" action, so it is the primary key, chosen by the owner, never reused.
   */
  readonly id: string;
  readonly parent: CvBulletParent;
  /** The display order among the parent's bullets. */
  readonly sortOrder: number;
  readonly importance: CvBulletImportance;
}

/** A CV bullet as a repository reads it back. */
export interface StoredCvBullet extends CvBulletLayout {
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<CvBulletDocument>;
}

/**
 * The CV bullet aggregate (D1): its own root because it is addressed from outside by its id
 * (entries name it, the agent's drill-down sends it). Its text is translated and published per
 * locale through the same `LocalizedRevisions` machine as projects: es and en required, de warned,
 * rollback by pointer. The entries that detail it are a reverse lookup, never a field.
 */
export class CvBullet implements CvBulletLayout {
  readonly id: string;
  readonly parent: CvBulletParent;
  readonly sortOrder: number;
  readonly importance: CvBulletImportance;

  private constructor(
    layout: CvBulletLayout,
    readonly version: number,
    private readonly machine: LocalizedRevisions<CvBulletDocument>,
  ) {
    this.id = layout.id;
    this.parent = { ...layout.parent };
    this.sortOrder = layout.sortOrder;
    this.importance = layout.importance;
  }

  /**
   * Creates a bullet with no revision in any locale, at version 0 (never stored).
   * @param layout the human id, the parent (fixed from now on), the order and the importance.
   * @throws {IdInvalid} when the id breaks the CV bullet id format.
   */
  static create(layout: CvBulletLayout): CvBullet {
    if (!isCvBulletId(layout.id)) throw new IdInvalid("cv-bullet", layout.id);
    return new CvBullet(layout, 0, LocalizedRevisions.empty(layout.id, cvBulletRules));
  }

  /**
   * Rebuilds a stored bullet without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredCvBullet): CvBullet {
    return new CvBullet(
      stored,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, cvBulletRules, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<CvBulletDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document the bullet's text in that locale, possibly blank in a draft.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the bullet is archived.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  saveRevision(
    locale: Locale,
    document: CvBulletDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<CvBulletDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<CvBulletDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the bullet, hiding every locale; its id stays taken.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
