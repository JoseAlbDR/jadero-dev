import { inject } from "vitest";

/** A plain, unquoted Postgres identifier: the only role and database names accepted. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A login role provisioning lets into a service database besides its owner, such as `api`'s
 * read-only `content_reader_dev`: its name and the password the test run gave it. The role exists
 * in the run's container with every attribute and setting `provision.sql` gives it.
 */
export interface ProvisionedRole {
  /** The role name, a plain identifier. */
  readonly name: string;
  /** The password the run's provisioning set; test-only and never printed. */
  readonly password: string;
}

/** What provisioning gave one database: its extensions and its extra login roles. */
export interface ProvisionedDatabase {
  /** Extensions other than `plpgsql`, sorted by name. */
  readonly extensions: readonly string[];
  /** Roles with `CONNECT` on the database other than its owner, sorted by name. */
  readonly roles: readonly ProvisionedRole[];
}

/**
 * The state `infra/postgres/provision.sql` left in the run's container, read once by the Postgres
 * global setup after it ran the script with `env=dev`, per service database (`content_dev`, ...).
 */
export interface ProvisioningSnapshot {
  readonly databases: Readonly<Record<string, ProvisionedDatabase>>;
}

declare module "vitest" {
  export interface ProvidedContext {
    /** What provisioning created in the run's container (`@jadero/testing/postgres-global-setup`). */
    postgresProvisioning: ProvisioningSnapshot;
  }
}

/**
 * Finds one database in a provisioning snapshot.
 * @throws when the name is not plain or provisioning did not create the database.
 */
function provisionedDatabase(
  snapshot: ProvisioningSnapshot,
  database: string,
): ProvisionedDatabase {
  if (!PLAIN_IDENTIFIER.test(database)) throw new Error(`Not a plain database name: ${database}`);
  const found = snapshot.databases[database];
  if (!found) {
    const known = Object.keys(snapshot.databases).sort().join(", ") || "none";
    throw new Error(`Provisioning created no database ${database} (it created: ${known})`);
  }
  return found;
}

/**
 * The untrusted extensions provisioning creates as superuser in one service database. The global
 * setup runs `infra/postgres/provision.sql`, the single source of truth (WP-12 step 1b, WP-8 D4),
 * and reads what it created, so the test harness cannot drift from provisioning: an extension
 * added only to the tests no longer turns them green while the deploy fails. Pass the result to
 * `createTestDatabase({ superuserExtensions })`.
 * @param database the dev database the script creates (`agent_dev` gives `["vector"]`).
 * @param snapshot what provisioning created; defaults to the one the global setup provides.
 * @returns the extension names, sorted.
 * @throws when the name is not plain or provisioning did not create the database.
 */
export function provisionedExtensions(
  database: string,
  snapshot: ProvisioningSnapshot = inject("postgresProvisioning"),
): string[] {
  return [...provisionedDatabase(snapshot, database).extensions];
}

/**
 * The extra login roles provisioning lets into one service database, read the same way as
 * {@link provisionedExtensions}. Pass the result to `createTestDatabase({ roles })`: the roles
 * are the real ones `provision.sql` created, with their memberships and settings (for
 * `content_reader_dev`: member of the group `content_reader`, read-only by default), so a setting
 * dropped from provisioning shows up as a failing test.
 * @param database the dev database the script creates (`content_dev` gives `content_reader_dev`).
 * @param snapshot what provisioning created; defaults to the one the global setup provides.
 * @returns the roles, sorted by name.
 * @throws when the name is not plain or provisioning did not create the database.
 */
export function provisionedRoles(
  database: string,
  snapshot: ProvisioningSnapshot = inject("postgresProvisioning"),
): ProvisionedRole[] {
  return [...provisionedDatabase(snapshot, database).roles];
}

/**
 * Checks that a role name can go into SQL text as is.
 * @param role the role to check.
 * @throws when its name is not plain.
 */
export function assertPlainRole(role: ProvisionedRole): void {
  if (!PLAIN_IDENTIFIER.test(role.name)) throw new Error(`Not a plain role name: ${role.name}`);
}
