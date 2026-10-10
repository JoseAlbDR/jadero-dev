import { randomUUID } from "node:crypto";
import { newPost, savePostRevision } from "./content.contract-fixtures.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { PostRepository } from "./post.repository.js";

/**
 * The contract every `PostRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized contract:
 * its republish test is the one the feed needs (`firstPublishedAt` stays when a fix is published),
 * and every reload of a published post passes the mapper's published slug check.
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
}
