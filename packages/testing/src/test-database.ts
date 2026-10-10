import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { assertPlainRole, type ProvisionedRole } from "./provisioned-roles.js";

/** Options of {@link createTestDatabase}. */
export interface TestDatabaseOptions {
  /**
   * Extensions the container's superuser creates in the new database before handing it over, as
   * provisioning does in production (ADR-027): `agent` passes `provisionedExtensions("agent_dev")`,
   * read from the provisioning script, which gives `["vector"]`: `vector` is not a trusted
   * extension and an ordinary role cannot create it. Plain lowercase names only.
   */
  readonly superuserExtensions?: readonly string[];
  /**
   * Extra login roles provisioning gives the database, such as `api`'s read-only `content_reader`:
   * `api` passes `provisionedRoles("content_dev")`, read from the provisioning script. Roles are
   * cluster-wide, so each is created once per container with its settings (idempotent, safe when
   * test files run in parallel), and only `CONNECT` on the new database is granted per file, after
   * `REVOKE CONNECT ... FROM PUBLIC`, as provisioning does.
   */
  readonly roles?: readonly ProvisionedRole[];
}

/** A per-file test database and how to remove it. */
export interface TestDatabase {
  /** Connects as the database's owner role, never as the container's superuser. */
  readonly url: string;
  /** Per role of `options.roles`, a URL that connects to this database as that role. */
  readonly roleUrls: Readonly<Record<string, string>>;
  /** Drops the database, then its owner role; provisioned roles stay for the other files. */
  readonly drop: () => Promise<void>;
}

/** Postgres error codes of a role that exists already, or that a parallel file is creating. */
const ROLE_EXISTS = new Set(["42710", "23505"]);

/**
 * The password of a provisioned role in this container: derived from the container's superuser URL,
 * so every test file of the run computes the same one without sharing state. Never printed.
 */
function rolePassword(adminUrl: string, role: string): string {
  return createHash("sha256").update(`${adminUrl}\n${role}`).digest("hex");
}

/**
 * Creates a provisioned role with its settings in one transaction, unless it exists: a parallel
 * file's `CREATE ROLE` waits for the first one's commit and then fails as a duplicate, which is
 * ignored, so nobody sees the role without its settings.
 */
async function ensureRole(adminUrl: string, role: ProvisionedRole): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE ROLE ${role.name} LOGIN PASSWORD '${rolePassword(adminUrl, role.name)}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    for (const [key, value] of Object.entries(role.settings)) {
      await client.query(`ALTER ROLE ${role.name} SET ${key} = ${value}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "string" || !ROLE_EXISTS.has(code)) throw error;
  } finally {
    await client.end();
  }
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
 * (Trace 2c). The role's password is random and never printed. Each of
 * `options.superuserExtensions` is created by the superuser inside the new database first, the way
 * provisioning creates `vector` for every `agent_*` database; the service's migration only asserts it.
 * Each of `options.roles` is created once per container and may connect to the new database only.
 * Needs the Postgres global setup (`@jadero/testing/postgres-global-setup`) in the Vitest config.
 * @param options extensions the superuser creates before the owner role takes over, and the
 * provisioned roles.
 * @returns the owner's connection URL, one URL per provisioned role, and a function that drops the
 * database and the owner role.
 * @throws when an extension name or a role is not plain.
 */
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const extensions = options.superuserExtensions ?? [];
  const roles = options.roles ?? [];
  // The names go into the SQL text, so only plain identifiers pass.
  const unsafe = extensions.find((extension) => !/^[a-z_][a-z0-9_]*$/.test(extension));
  if (unsafe !== undefined) throw new Error(`Not a plain extension name: ${unsafe}`);
  for (const role of roles) assertPlainRole(role);
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
  if (extensions.length > 0) {
    const superuserInDatabase = new URL(adminUrl);
    superuserInDatabase.pathname = `/${name}`;
    for (const extension of extensions) {
      await asSuperuser(
        superuserInDatabase.toString(),
        `CREATE EXTENSION IF NOT EXISTS ${extension}`,
      );
    }
  }
  const roleUrls: Record<string, string> = {};
  if (roles.length > 0) {
    await asSuperuser(adminUrl, `REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
    for (const provisioned of roles) {
      await ensureRole(adminUrl, provisioned);
      await asSuperuser(adminUrl, `GRANT CONNECT ON DATABASE ${name} TO ${provisioned.name}`);
      const roleUrl = new URL(adminUrl);
      roleUrl.username = provisioned.name;
      roleUrl.password = rolePassword(adminUrl, provisioned.name);
      roleUrl.pathname = `/${name}`;
      roleUrls[provisioned.name] = roleUrl.toString();
    }
  }
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    roleUrls,
    drop: async () => {
      await asSuperuser(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await asSuperuser(adminUrl, `DROP ROLE IF EXISTS ${role}`);
    },
  };
}
