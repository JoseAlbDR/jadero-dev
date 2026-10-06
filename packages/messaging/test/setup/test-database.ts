import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

/** A per-file test database and how to remove it. */
export interface TestDatabase {
  /** Connects as the database's owner role, never as the container's superuser. */
  readonly url: string;
  /** Drops the database, then its role. */
  readonly drop: () => Promise<void>;
}

/** Runs one statement as the container's superuser, on a short-lived client. */
async function asSuperuser(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * Creates an empty database for one test file in the run's container, so files run in parallel
 * without sharing rows. Like production (WP-10 "Tests run migrations as a non-superuser", D4), it
 * is owned by a fresh ordinary role (LOGIN, no superuser, no CREATEDB, no CREATEROLE) and the URL
 * connects as that role: a migration that needs a superuser fails here, not in the deploy
 * (Trace 2c). The role's password is random and never printed.
 * @returns the owner's connection URL and a function that drops the database and the role.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject("postgresAdminUrl");
  // Hex only, so the names and the password are safe inside the SQL text.
  const suffix = randomBytes(12).toString("hex");
  const name = `test_${suffix}`;
  const role = `owner_${suffix}`;
  const password = randomBytes(24).toString("hex");
  await asSuperuser(
    adminUrl,
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  await asSuperuser(adminUrl, `CREATE DATABASE ${name} OWNER ${role}`);
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      await asSuperuser(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await asSuperuser(adminUrl, `DROP ROLE IF EXISTS ${role}`);
    },
  };
}
