import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A plain, unquoted Postgres identifier: the only database and extension names accepted. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The script the dev Postgres runs as superuser on an empty volume, relative to the repo root. */
const INIT_SCRIPT = join("infra", "compose", "init", "01-databases.sql");

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
 * Reads, from the text of a provisioning script, the extensions it creates in one database: every
 * `CREATE EXTENSION [IF NOT EXISTS] <name>;` that follows `\connect <database>` and comes before the
 * next `\connect`. Strict on purpose, since a test that silently finds nothing would pass a broken
 * provisioning: a `\connect` or `CREATE EXTENSION` line in any other form throws.
 * @param sql the script's text.
 * @param database the database name, as the script's `\connect` names it (`agent_dev`).
 * @returns the extension names, lowercase, in script order; empty when the block creates none.
 * @throws when `database` is not a plain identifier, the script never connects to it, or a
 * `\connect` or `CREATE EXTENSION` line is not in the plain form.
 */
export function parseProvisionedExtensions(sql: string, database: string): string[] {
  if (!PLAIN_IDENTIFIER.test(database)) throw new Error(`Not a plain database name: ${database}`);
  let current: string | undefined;
  let connected = false;
  const extensions: string[] = [];
  for (const [index, raw] of sql.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("--")) continue;
    if (/^\\c(?:onnect)?\b/.test(line)) {
      const connect = /^\\c(?:onnect)?\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
      if (!connect) throw new Error(`line ${index + 1}: expected "\\connect <database>": ${line}`);
      current = connect[1];
      if (current === database) connected = true;
      continue;
    }
    if (/^CREATE\s+EXTENSION\b/i.test(line)) {
      const create =
        /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*;$/i.exec(line);
      if (!create?.[1]) {
        throw new Error(
          `line ${index + 1}: expected "CREATE EXTENSION [IF NOT EXISTS] <name>;": ${line}`,
        );
      }
      if (current === database) extensions.push(create[1].toLowerCase());
    }
  }
  if (!connected) throw new Error(`The provisioning script has no "\\connect ${database}" block`);
  return extensions;
}

/**
 * Reads the provisioning script: the repo's init script by default.
 * @param script absolute path of a provisioning script; defaults to the repo's init script.
 * @returns the script's text.
 * @throws when the script is missing.
 */
export function readProvisioningScript(script?: string): string {
  const path = script ?? join(repositoryRoot(), INIT_SCRIPT);
  if (!existsSync(path)) throw new Error(`Provisioning script not found: ${path}`);
  return readFileSync(path, "utf8");
}

/**
 * The untrusted extensions provisioning creates as superuser in one service database, read from
 * `infra/compose/init/01-databases.sql`, the single source of truth (WP-12 step 1b). Pass the
 * result to `createTestDatabase({ superuserExtensions })`, so the test harness cannot drift from
 * provisioning: an extension added only to the tests no longer turns them green while the deploy
 * fails, because the tests read the same list the database gets.
 * @param database the dev database name in the script (`agent_dev` gives `["vector"]`).
 * @param script absolute path of the provisioning script; defaults to the repo's init script.
 * @returns the extension names, lowercase, in script order.
 * @throws when the script is missing or {@link parseProvisionedExtensions} rejects it.
 */
export function provisionedExtensions(database: string, script?: string): string[] {
  return parseProvisionedExtensions(readProvisioningScript(script), database);
}
