import { createTestDatabase, provisionedRoles, type TestDatabase } from "@jadero/testing";

/**
 * The read-only login role of the public content reads, as provisioning names it in dev and in
 * the test container: a member of the group role `content_reader` that migration 0002 grants to.
 */
export const CONTENT_READER = "content_reader_dev";

/**
 * A per-file test database for `api`, provisioned like `content_dev`: owned by an ordinary role,
 * with the extra login roles `infra/postgres/provision.sql` lets into `content_dev`
 * (`content_reader_dev`, read-only by default, inheriting the grants of `content_reader`, which
 * migration 0002 grants to and refuses to run without).
 * @returns the database, with `roleUrls.content_reader_dev` to connect as the reader.
 */
export function createContentTestDatabase(): Promise<TestDatabase> {
  return createTestDatabase({ roles: provisionedRoles("content_dev") });
}
