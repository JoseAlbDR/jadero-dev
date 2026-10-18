import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { ProvisionedDatabase, ProvisioningSnapshot } from "./provisioned.js";

/** The convergent provisioning script of every environment, relative to the repo root (WP-8 D4). */
const PROVISION_SCRIPT = join("infra", "postgres", "provision.sql");

/** Where the script is copied inside a test container (the dev container mounts it there too). */
const SCRIPT_IN_CONTAINER = "/jadero/provision.sql";

/** The environments `provision.sql` accepts as `-v env=...`. */
export type ProvisioningEnv = "dev" | "staging" | "prod" | "ops";

/** The services `provision.sql` accepts as `-v service=...`, to converge only that one's roles. */
export type ProvisioningService = "api" | "agent" | "contact";

/**
 * The environment variables `provision.sql` reads its passwords from, per kind of run: the
 * service roles for `dev`, `staging` and `prod`, Umami's for `ops`.
 */
export const SERVICE_PASSWORD_VARIABLES = [
  "CONTENT_DB_PASSWORD",
  "CONTENT_READER_DB_PASSWORD",
  "AGENT_DB_PASSWORD",
  "CONTACT_DB_PASSWORD",
] as const;

/** The outcome of one provisioning run: psql's exit code and what it printed (never a password). */
export interface ProvisioningResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * The repository root: the nearest folder above this file that holds `pnpm-workspace.yaml`. Works
 * from `src/` (this package's own tests) and from `dist/` (a service's tests import the build).
 * @returns the absolute path of the repository root.
 * @throws when no folder above holds `pnpm-workspace.yaml`.
 */
function repositoryRoot(): string {
  let folder = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(folder, "pnpm-workspace.yaml"))) {
    const parent = dirname(folder);
    if (parent === folder) {
      throw new Error("No pnpm-workspace.yaml above @jadero/testing: cannot find the repo root");
    }
    folder = parent;
  }
  return folder;
}

/**
 * Runs `infra/postgres/provision.sql` in a Postgres test container, the way a deploy runs it on
 * the server: psql inside the container as the superuser over the socket, the environment as
 * `-v env=...`, the passwords in psql's environment, never in its argv. Copies the script in first,
 * so a second call runs the current file again (the convergence test calls it twice).
 * @param container the started container.
 * @param env the environment to provision.
 * @param passwords the password variables (`SERVICE_PASSWORD_VARIABLES`, or `UMAMI_DB_PASSWORD`).
 * @param service when set, `-v service=...`: the run converges only that service's roles, as a
 * deploy of it does (WP-9 D4); a string outside `ProvisioningService` is passed as it is, so a
 * test can check the refusal.
 * @returns psql's exit code and output; the caller decides whether a non-zero code is a failure.
 */
export async function runProvisioning(
  container: StartedPostgreSqlContainer,
  env: ProvisioningEnv,
  passwords: Readonly<Record<string, string>>,
  service?: ProvisioningService,
): Promise<ProvisioningResult> {
  await container.copyFilesToContainer([
    { source: join(repositoryRoot(), PROVISION_SCRIPT), target: SCRIPT_IN_CONTAINER },
  ]);
  const { exitCode, output } = await container.exec(
    [
      "psql",
      "--no-psqlrc",
      "--quiet",
      "--username",
      container.getUsername(),
      "--dbname",
      container.getDatabase(),
      "--set",
      `env=${env}`,
      ...(service === undefined ? [] : ["--set", `service=${service}`]),
      "--file",
      SCRIPT_IN_CONTAINER,
    ],
    { env: { ...passwords } },
  );
  return { exitCode, output };
}

/**
 * Reads what provisioning left in a cluster, per database other than `postgres` and the
 * superuser's own: the extensions (without `plpgsql`) and the login roles with `CONNECT` other
 * than the owner, each given `password`, the one the caller provisioned every role with.
 * @param adminUrl the superuser's connection URL.
 * @param password the password the provisioning run gave every role.
 * @returns the snapshot the test files read through `provisionedExtensions` and `provisionedRoles`.
 */
export async function readProvisioningSnapshot(
  adminUrl: string,
  password: string,
): Promise<ProvisioningSnapshot> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const databases: Record<string, ProvisionedDatabase> = {};
  try {
    const { rows } = await admin.query<{ datname: string; roles: string[] }>(
      `SELECT d.datname,
              coalesce(array_agg(DISTINCT r.rolname::text ORDER BY r.rolname::text)
                FILTER (WHERE r.rolname IS NOT NULL), '{}'::text[]) AS roles
         FROM pg_database d
         LEFT JOIN LATERAL aclexplode(d.datacl) a
           ON a.privilege_type = 'CONNECT' AND a.grantee <> d.datdba
         LEFT JOIN pg_roles r ON r.oid = a.grantee AND r.rolcanlogin
        WHERE d.datallowconn AND NOT d.datistemplate
          AND d.datname NOT IN ('postgres', current_database())
        GROUP BY d.datname`,
    );
    for (const row of rows) {
      const url = new URL(adminUrl);
      url.pathname = `/${row.datname}`;
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        const extensions = await client.query<{ extname: string }>(
          "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
        );
        databases[row.datname] = {
          extensions: extensions.rows.map((extension) => extension.extname),
          roles: row.roles.map((name) => ({ name, password })),
        };
      } finally {
        await client.end();
      }
    }
  } finally {
    await admin.end();
  }
  return { databases };
}
