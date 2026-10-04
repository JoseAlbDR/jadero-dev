import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

/**
 * Creates an empty database for one test file in the run's container, so files run in parallel
 * without sharing rows.
 * @returns its connection URL and a function that drops it.
 */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const adminUrl = new URL(inject("postgresAdminUrl"));
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const client = new pg.Client({ connectionString: adminUrl.toString() });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    },
  };
}
