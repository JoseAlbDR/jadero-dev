/**
 * The Postgres image of the integration tests; `test/images.test.ts` keeps it equal to
 * `infra/compose/compose.dev.yml`, so dev and tests cannot drift.
 */
export const POSTGRES_IMAGE = "pgvector/pgvector:0.8.7-pg18";
