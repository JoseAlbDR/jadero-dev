import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Post } from "../domain/post.js";
import { newJournalPost, newPost, savePostRevision } from "./content.contract-fixtures.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { PostRepository } from "./post.repository.js";

/**
 * The contract every `PostRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized contract:
 * its republish test is the one the feed needs (`firstPublishedAt` stays when a fix is published),
 * and every reload of a published post passes the mapper's published slug check. Then the journal
 * kind (WP-39 D1): kind and WP survive a reload, and a journal post is found by its WP.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository for each test.
 */
export function postRepositoryContract(
  name: string,
  make: () => PostRepository | Promise<PostRepository>,
): void {
  localizedRepositoryContract(name, {
    port: "PostRepository",
    make,
    create: () => newPost(),
    saveRevision: savePostRevision,
    load: (repository, post) => repository.get(post.id),
    loadUnknown: (repository) => repository.get(randomUUID()),
    save: (repository, post, expectedVersion) => repository.save(post, expectedVersion),
    archive: (post, archivedAt) => post.archive(archivedAt),
  });

  /** Saves a post with es and en at revision 1; returns it reloaded at version 1. */
  async function stored(repository: PostRepository, post: Post): Promise<Post> {
    savePostRevision(post, "es");
    savePostRevision(post, "en");
    await repository.save(post, 0);
    return (await repository.get(post.id)) as Post;
  }

  describe(`PostRepository journal contract: ${name}`, () => {
    it("reloads a blog post as kind post with no WP", async () => {
      const repository = await make();
      const reloaded = await stored(repository, newPost());
      expect(reloaded).toMatchObject({ kind: "post", wp: null });
    });

    it("finds a journal post by its WP, equal to what was saved", async () => {
      const repository = await make();
      const journal = newJournalPost();
      const reloaded = await stored(repository, journal);
      expect(reloaded).toMatchObject({ kind: "journal", wp: journal.wp });
      const found = await repository.findJournal(journal.wp as number);
      expect(found?.snapshot()).toEqual(reloaded.snapshot());
    });

    it("finds no journal post for a WP that has none", async () => {
      const repository = await make();
      await stored(repository, newJournalPost());
      expect(await repository.findJournal(randomInt(2_000_000_000, 2_100_000_000))).toBeUndefined();
    });
  });
}
