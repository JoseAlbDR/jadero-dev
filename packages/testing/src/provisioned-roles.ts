import { readProvisioningScript } from "./provisioned-extensions.js";

/** A plain, unquoted Postgres identifier: the only role, database and setting names accepted. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A setting value written without quotes: `on`, `off`, a number. */
const PLAIN_VALUE = /^[A-Za-z0-9_]+$/;

/**
 * A login role provisioning creates next to a service database's owner, such as `api`'s read-only
 * `content_reader`: its name and the settings every session of it starts with.
 */
export interface ProvisionedRole {
  /** The role name, a plain identifier. */
  readonly name: string;
  /** `ALTER ROLE <name> SET <key> = <value>` settings, such as `default_transaction_read_only: "on"`. */
  readonly settings: Readonly<Record<string, string>>;
}

/**
 * Reads, from the text of a provisioning script, the extra login roles of one database: every role
 * the script grants `CONNECT` on it (`GRANT CONNECT ON DATABASE <database> TO <role>;`), with the
 * settings of its `ALTER ROLE <role> SET <key> = <value>;` lines. The owner role needs no such grant
 * and is not returned. Strict like `parseProvisionedExtensions`: a `GRANT CONNECT`, `ALTER ROLE` or
 * `CREATE ROLE` line in any other form throws, so a test that silently finds no role cannot pass a
 * broken provisioning.
 * @param sql the script's text.
 * @param database the database name (`content_dev`).
 * @returns the roles in script order; empty when the database has none.
 * @throws when `database` is not a plain identifier, a line is not in the plain form, or a granted
 * role is not created with `LOGIN` in the script.
 */
export function parseProvisionedRoles(sql: string, database: string): ProvisionedRole[] {
  if (!PLAIN_IDENTIFIER.test(database)) throw new Error(`Not a plain database name: ${database}`);
  const logins = new Set<string>();
  const granted: string[] = [];
  const settings = new Map<string, Record<string, string>>();
  for (const [index, raw] of sql.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const where = `line ${index + 1}`;
    if (/^CREATE\s+ROLE\b/i.test(line)) {
      const create = /^CREATE\s+ROLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.*);$/i.exec(line);
      if (!create?.[1] || create[2] === undefined) {
        throw new Error(`${where}: expected "CREATE ROLE <name> <options>;": ${line}`);
      }
      if (/(^|\s)LOGIN(\s|$)/i.test(create[2])) logins.add(create[1]);
      continue;
    }
    if (/^GRANT\s+CONNECT\b/i.test(line)) {
      const grant =
        /^GRANT\s+CONNECT\s+ON\s+DATABASE\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)\s*;$/i.exec(
          line,
        );
      if (!grant?.[1] || !grant[2]) {
        throw new Error(
          `${where}: expected "GRANT CONNECT ON DATABASE <database> TO <role>;": ${line}`,
        );
      }
      if (grant[1] === database && !granted.includes(grant[2])) granted.push(grant[2]);
      continue;
    }
    if (/^ALTER\s+ROLE\b/i.test(line)) {
      const alter =
        /^ALTER\s+ROLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|TO)\s*([A-Za-z0-9_]+)\s*;$/i.exec(
          line,
        );
      if (!alter?.[1] || !alter[2] || !alter[3]) {
        throw new Error(`${where}: expected "ALTER ROLE <role> SET <key> = <value>;": ${line}`);
      }
      const role = settings.get(alter[1]) ?? {};
      role[alter[2].toLowerCase()] = alter[3];
      settings.set(alter[1], role);
    }
  }
  return granted.map((name) => {
    if (!logins.has(name)) {
      throw new Error(
        `Role ${name} is granted CONNECT on ${database} but never created with LOGIN`,
      );
    }
    return { name, settings: settings.get(name) ?? {} };
  });
}

/**
 * The extra login roles provisioning gives one service database, read from
 * `infra/compose/init/01-databases.sql`, the single source of truth (WP-12 step 7, the same parity
 * rule as {@link provisionedExtensions}). Pass the result to `createTestDatabase({ roles })`, so the
 * tests create the role the migrations grant to with the settings the deploy gives it: a role added
 * only to the tests, or a setting dropped from provisioning, shows up as a failing test.
 * @param database the dev database name in the script (`content_dev` gives `content_reader`).
 * @param script absolute path of the provisioning script; defaults to the repo's init script.
 * @returns the roles in script order.
 * @throws when the script is missing or {@link parseProvisionedRoles} rejects it.
 */
export function provisionedRoles(database: string, script?: string): ProvisionedRole[] {
  return parseProvisionedRoles(readProvisioningScript(script), database);
}

/**
 * Checks that a role can go into SQL text as is.
 * @param role the role to check.
 * @throws when its name, a setting key or a setting value is not plain.
 */
export function assertPlainRole(role: ProvisionedRole): void {
  if (!PLAIN_IDENTIFIER.test(role.name)) throw new Error(`Not a plain role name: ${role.name}`);
  for (const [key, value] of Object.entries(role.settings)) {
    if (!PLAIN_IDENTIFIER.test(key) || !PLAIN_VALUE.test(value)) {
      throw new Error(`Not a plain setting of role ${role.name}: ${key}`);
    }
  }
}
