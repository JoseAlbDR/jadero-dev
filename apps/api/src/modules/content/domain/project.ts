import { SlugInvalid } from "./content.errors.js";
import { invalidEntries, isFilled, isSlug, isTag, isUrlWith } from "./field-formats.js";
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

/** The kind of a project (ADR-011): a long case study, a regular project or an early one. */
export type ProjectKind = "case_study" | "project" | "early";

/**
 * One locale of a project, the content of a revision (Q1 B): the translated text and the fields
 * shared by every locale, which go live only through publish. Text may be empty in a draft.
 */
export interface ProjectDocument {
  /** The localized slug, `portal-de-empleo` in Spanish. */
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  /** Markdown, stored raw (ADR-011). */
  readonly body: string;
  readonly stackTags: readonly string[];
  readonly repoUrl: string | null;
  readonly demoUrl: string | null;
}

/**
 * The rules of a project document. Format on save: a localized slug that is a slug, tags of 1 to 60
 * characters, HTTPS repository and demo URLs. Complete for publish: what `projectDto` requires (a
 * localized slug and a title) plus a body, the page itself.
 */
export const projectRules: DocumentRules<ProjectDocument> = {
  invalidFields: (doc) => [
    ...(isFilled(doc.slug) && !isSlug(doc.slug) ? ["slug"] : []),
    ...invalidEntries("stackTags", doc.stackTags, isTag),
    ...(doc.repoUrl !== null && !isUrlWith(doc.repoUrl, ["https"]) ? ["repoUrl"] : []),
    ...(doc.demoUrl !== null && !isUrlWith(doc.demoUrl, ["https"]) ? ["demoUrl"] : []),
  ],
  isComplete: (doc) => isSlug(doc.slug) && isFilled(doc.title) && isFilled(doc.body),
};

/** The layout fields of a project, kept on the root and changed without a revision (Q1 B). */
export interface ProjectLayout {
  readonly id: string;
  /** The canonical slug: stable, for admin routes and events, not shown in a URL. */
  readonly slug: string;
  readonly kind: ProjectKind;
  readonly featured: boolean;
  readonly sortOrder: number;
}

/** A project as a repository reads it back. */
export interface StoredProject extends ProjectLayout {
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<ProjectDocument>;
}

/**
 * The project aggregate (D1): its layout on the root, its locales and revisions in the publish state
 * machine it contains. `version` is the one it was loaded at; the repository compares it (D5).
 */
export class Project implements ProjectLayout {
  readonly id: string;
  readonly slug: string;
  readonly kind: ProjectKind;
  readonly featured: boolean;
  readonly sortOrder: number;

  private constructor(
    layout: ProjectLayout,
    readonly version: number,
    private readonly machine: LocalizedRevisions<ProjectDocument>,
  ) {
    this.id = layout.id;
    this.slug = layout.slug;
    this.kind = layout.kind;
    this.featured = layout.featured;
    this.sortOrder = layout.sortOrder;
  }

  /**
   * Creates a project with no revision in any locale, at version 0 (never stored).
   * @param layout the identity, chosen by the use case, and the layout fields.
   * @throws {SlugInvalid} when the canonical slug breaks the slug rule.
   */
  static create(layout: ProjectLayout): Project {
    if (!isSlug(layout.slug)) throw new SlugInvalid(layout.slug);
    return new Project(layout, 0, LocalizedRevisions.empty(layout.id, projectRules));
  }

  /**
   * Rebuilds a stored project without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredProject): Project {
    return new Project(
      stored,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, projectRules, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<ProjectDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full project, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the project is archived.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  saveRevision(
    locale: Locale,
    document: ProjectDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<ProjectDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<ProjectDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the project, hiding every locale.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
