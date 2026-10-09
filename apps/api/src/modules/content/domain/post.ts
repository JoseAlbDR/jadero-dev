import { SlugInvalid } from "./content.errors.js";
import type { Locale } from "./locale.js";
import {
  LocalizedRevisions,
  type LocalizedRevisionsSnapshot,
  type LocalizedRevisionsView,
  type PublishResult,
  type PublishTarget,
} from "./localized-revisions.js";
import type { Revision, RevisionOrigin } from "./revision.js";
import { isFilled, isSlug } from "./slug.js";

/** One locale of a post, the content of a revision (Q1 B). Text may be empty in a draft. */
export interface PostDocument {
  /** The localized slug. */
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  /** Markdown, stored raw (ADR-011). */
  readonly body: string;
  readonly tags: readonly string[];
}

/**
 * Whether a post document can be published: a localized slug, a title, an excerpt and a body.
 * @param document one locale's revision content.
 * @returns true when every required field is filled.
 */
export function isPostComplete(document: PostDocument): boolean {
  return (
    isSlug(document.slug) &&
    isFilled(document.title) &&
    isFilled(document.excerpt) &&
    isFilled(document.body)
  );
}

/** The layout fields of a post, kept on the root (Q1 B). */
export interface PostLayout {
  readonly id: string;
  /** The canonical slug: stable, for admin routes and events. */
  readonly slug: string;
}

/** A post as a repository reads it back. */
export interface StoredPost extends PostLayout {
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<PostDocument>;
}

/**
 * The post aggregate (D1). A post's status and publish time are its locales' states and
 * `publishedAt` (ADR-011's `status` and `publishedAt`), not fields of their own.
 */
export class Post implements PostLayout {
  readonly id: string;
  readonly slug: string;

  private constructor(
    layout: PostLayout,
    readonly version: number,
    private readonly machine: LocalizedRevisions<PostDocument>,
  ) {
    this.id = layout.id;
    this.slug = layout.slug;
  }

  /**
   * Creates a post with no revision in any locale, at version 0 (never stored).
   * @param layout the identity, chosen by the use case, and the canonical slug.
   * @throws {SlugInvalid} when the canonical slug breaks the slug rule.
   */
  static create(layout: PostLayout): Post {
    if (!isSlug(layout.slug)) throw new SlugInvalid(layout.slug);
    return new Post(layout, 0, LocalizedRevisions.empty(layout.id, isPostComplete));
  }

  /**
   * Rebuilds a stored post without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredPost): Post {
    return new Post(
      stored,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, isPostComplete, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<PostDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full post, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the post is archived.
   */
  saveRevision(
    locale: Locale,
    document: PostDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<PostDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<PostDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the post, hiding every locale.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
