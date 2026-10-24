import { z } from "zod";
import { postDocumentSchema, postKindSchema } from "../application/content-documents.js";
import { Post } from "../domain/post.js";
import {
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  publishedSlugOf,
  publishedSlugRule,
  type RevisionRow,
  readStored,
  type SlugTranslationRow,
} from "./revision-rows.js";

/** A stored work package number, a positive integer (`posts_wp_check`). */
const wpSchema = z.int().min(1).nullable();

/** A `content.posts` row: identity, the canonical slug, the kind and WP, and the archive mark. */
export interface PostBaseRow {
  readonly id: string;
  readonly slug: string;
  /** Read back through `postKindSchema`, like a project's kind. */
  readonly kind: string;
  readonly wp: number | null;
  readonly archivedAt: Date | null;
  readonly version: number;
}

/** A `content.post_translations` row: the shared pointers plus the published slug. */
export type PostTranslationRow = SlugTranslationRow;

/**
 * The rows of a post at its next version. Each locale's published slug is copied from its
 * published revision's document, and its `first_published_at` from the domain, which never moves
 * it after the first publish (the feed's order, step 3 follow-ups).
 * @param post the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 */
export function postToRows(
  post: Post,
  version: number,
): LocalizedItemRows<PostBaseRow, PostTranslationRow> {
  const stored = post.snapshot();
  return {
    base: {
      id: stored.id,
      slug: stored.slug,
      kind: stored.kind,
      wp: stored.wp,
      archivedAt: stored.translations.archivedAt,
      version,
    },
    ...localizedRows(
      stored.id,
      stored.translations,
      post.unsavedRevisions(),
      postDocumentSchema,
      publishedSlugOf,
    ),
  };
}

/**
 * Rebuilds a post from its rows, checking that each locale's published slug is its published
 * revision's slug, as for projects.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the post at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back, or a slug disagrees.
 */
export function postFromRows(
  base: PostBaseRow,
  translations: readonly PostTranslationRow[],
  revisions: readonly RevisionRow[],
): Post {
  return Post.reconstitute({
    id: base.id,
    slug: base.slug,
    kind: readStored(postKindSchema, base.kind, base.id, "kind"),
    wp: readStored(wpSchema, base.wp, base.id, "wp"),
    version: base.version,
    translations: localizedSnapshot(
      base.id,
      translations,
      revisions,
      postDocumentSchema,
      base.archivedAt,
      publishedSlugRule(base.id),
    ),
  });
}
