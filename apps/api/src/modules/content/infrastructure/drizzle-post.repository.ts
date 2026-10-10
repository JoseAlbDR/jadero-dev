import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { PostRepository } from "../application/post.repository.js";
import type { Post } from "../domain/post.js";
import { postRevisions, posts, postTranslations } from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import { type PostTranslationRow, postFromRows, postToRows } from "./post-rows.js";

/**
 * The Drizzle adapter of `PostRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection when `DrizzleContentUnitOfWork` builds it inside `run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzlePostRepository extends PostRepository {
  private readonly localized: DrizzleLocalizedRows<PostTranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, postRevisions, postTranslations, {
      publishedSlug: postTranslations.publishedSlug,
    });
  }

  /**
   * Reads the root row, the translation rows and the revisions they point at, then rebuilds the
   * post through the shared mapper.
   * @param id the post's id.
   * @returns the post, or undefined when no row has this id.
   */
  async get(id: string): Promise<Post | undefined> {
    const [base] = await this.db
      .select({
        id: posts.id,
        slug: posts.slug,
        archivedAt: posts.archivedAt,
        version: posts.version,
      })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(id);
    return postFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.posts` with the
   * layout fields, which takes the row lock; (2) `INSERT` of every unsaved revision; (3) the upsert
   * of every locale's pointers, after the revisions they point at.
   * @param post the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new post.
   */
  async save(post: Post, expectedVersion: number): Promise<void> {
    const rows = postToRows(post, expectedVersion + 1);
    const { id, version: _version, ...layout } = rows.base;
    await compareAndSet(this.db, posts, id, expectedVersion, { id, ...layout }, layout);
    await this.localized.store(rows);
  }
}
