import { PostRepository } from "../application/post.repository.js";
import type { Post } from "../domain/post.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";
import {
  type PostBaseRow,
  type PostTranslationRow,
  postFromRows,
  postToRows,
} from "./post-rows.js";

/** What the fake stores per post: the rows of its three tables. */
export type PostRecord = LocalizedRecord<PostBaseRow, PostTranslationRow>;

/**
 * The fake adapter of `PostRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper. Passes the same contract suite as
 * `DrizzlePostRepository`.
 */
export class InMemoryPostRepository extends PostRepository {
  /** @param records the committed records, or a unit of work's staged view of them. */
  constructor(private readonly records: RecordStore<PostRecord> = new InMemoryRecords()) {
    super();
  }

  /**
   * Rebuilds the stored post from the revisions its pointers name.
   * @param id the post's id.
   * @returns the post, or undefined.
   */
  async get(id: string): Promise<Post | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    return postFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the post's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param post the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new post.
   */
  async save(post: Post, expectedVersion: number): Promise<void> {
    const rows = postToRows(post, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, post.id, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
