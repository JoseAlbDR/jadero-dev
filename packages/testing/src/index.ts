// Test helpers only (WP-12 step 1): a dev dependency, never imported by production code. The
// Postgres global setup is `@jadero/testing/postgres-global-setup` and the schema drift check is
// `@jadero/testing/drizzle`, so a package that needs neither loads no drizzle-kit.
export { useDockerContextHost } from "./docker-host.js";
export { POSTGRES_IMAGE } from "./images.js";
export { parseProvisionedExtensions, provisionedExtensions } from "./provisioned-extensions.js";
export {
  createTestDatabase,
  type TestDatabase,
  type TestDatabaseOptions,
} from "./test-database.js";
