import { createTestDatabase, provisionedRoles, type TestDatabase } from "@jadero/testing";

/** The read-only role of the public content reads, as provisioning names it. */
export const CONTENT_READER = "content_reader";

/**
 * A per-file test database for `api`, provisioned like `content_dev`: owned by an ordinary role,
 * with the extra roles of `infra/compose/init/01-databases.sql` (`content_reader`, read-only by
 * default), which migration 0002 grants to and refuses to run without.
 * @returns the database, with `roleUrls.content_reader` to connect as the reader.
 */
export function createContentTestDatabase(): Promise<TestDatabase> {
  return createTestDatabase({ roles: provisionedRoles("content_dev") });
}
