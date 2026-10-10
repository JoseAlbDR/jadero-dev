import type { Post } from "../domain/post.js";

/**
 * The port of post storage, an abstract class so it is also the DI token (ADR-003). Adapters in
 * infrastructure/ implement it and pass `postRepositoryContract`.
 */
export abstract class PostRepository {
  /**
   * Loads one post with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @param id the post's id.
   * @returns the post at its stored version, or undefined when no post has this id.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract get(id: string): Promise<Post | undefined>;

  /**
   * Stores the post when it is still at `expectedVersion` (D5, compare-and-set): its layout,
   * every revision saved since it was loaded, and its per-locale pointers; the stored version
   * becomes `expectedVersion + 1`. `expectedVersion` 0 creates it. Atomic only inside the unit of
   * work, which every write uses.
   * @param post the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for a new post.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract save(post: Post, expectedVersion: number): Promise<void>;
}
