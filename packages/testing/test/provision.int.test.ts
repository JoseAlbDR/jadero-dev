import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useDockerContextHost } from "../src/docker-host.js";
import { POSTGRES_IMAGE } from "../src/images.js";
import { runProvisioning, SERVICE_PASSWORD_VARIABLES } from "../src/provision.js";

// infra/postgres/provision.sql against the pinned image, from an empty cluster, run twice with
// env=staging as a deploy would (WP-8 D4): the second run must change nothing but the passwords.

let container: StartedPostgreSqlContainer;

/** A fresh password per role, hex only; test-only values, never printed. */
function freshPasswords(): Record<string, string> {
  return Object.fromEntries(
    SERVICE_PASSWORD_VARIABLES.map((name) => [name, randomBytes(16).toString("hex")]),
  );
}

/** A superuser or role URL to one database of the test container. */
function urlFor(database: string, role?: { name: string; password: string }): string {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${database}`;
  if (role) {
    url.username = role.name;
    url.password = role.password;
  }
  return url.toString();
}

/** Runs one query on a short-lived client and returns its rows. */
async function query<Row extends pg.QueryResultRow>(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** The Postgres error code a connection attempt fails with, or undefined when it succeeds. */
async function connectFailure(url: string): Promise<string | undefined> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Everything provisioning converges, as plain rows, so two runs can be compared with toEqual. */
async function catalog(): Promise<unknown> {
  const admin = urlFor(container.getDatabase());
  return {
    roles: await query(
      admin,
      `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls, rolconfig
         FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> current_user ORDER BY rolname`,
    ),
    memberships: await query(
      admin,
      `SELECT m.roleid::regrole::text AS "group", m.member::regrole::text AS member,
              m.inherit_option, m.admin_option
         FROM pg_auth_members m WHERE m.roleid::regrole::text !~ '^pg_' ORDER BY 1, 2`,
    ),
    databases: await query(
      admin,
      `SELECT datname, datdba::regrole::text AS owner, datacl::text[] AS acl
         FROM pg_database WHERE NOT datistemplate AND datname <> current_database()
        ORDER BY datname`,
    ),
  };
}

let firstPasswords: Record<string, string>;
let secondPasswords: Record<string, string>;
let afterFirstRun: unknown;
let secondOutput: string;

beforeAll(async () => {
  useDockerContextHost();
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  firstPasswords = freshPasswords();
  const first = await runProvisioning(container, "staging", firstPasswords);
  expect(first.exitCode, first.output).toBe(0);
  afterFirstRun = await catalog();
  // The second run rotates every password, as a re-run with new secrets would.
  secondPasswords = freshPasswords();
  const second = await runProvisioning(container, "staging", secondPasswords);
  expect(second.exitCode, second.output).toBe(0);
  secondOutput = second.output;
});

afterAll(async () => {
  await container?.stop();
});

describe("provision.sql, run twice with env=staging", () => {
  it("lands in the same roles, memberships, owners and grants on the second run", async () => {
    expect(await catalog()).toEqual(afterFirstRun);
  });

  it("creates one database per service, owned by the role of the same name", async () => {
    const rows = await query<{ datname: string; owner: string }>(
      urlFor(container.getDatabase()),
      `SELECT datname, datdba::regrole::text AS owner FROM pg_database
        WHERE datname LIKE '%\\_staging' ORDER BY datname`,
    );
    expect(rows).toEqual([
      { datname: "agent_staging", owner: "agent_staging" },
      { datname: "contact_staging", owner: "contact_staging" },
      { datname: "content_staging", owner: "content_staging" },
    ]);
  });

  it("makes content_reader a group that cannot log in, and content_reader_staging a read-only member", async () => {
    const admin = urlFor(container.getDatabase());
    const [group] = await query<{ rolcanlogin: boolean }>(
      admin,
      "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'content_reader'",
    );
    expect(group?.rolcanlogin).toBe(false);
    const [membership] = await query<{ inherit_option: boolean }>(
      admin,
      `SELECT inherit_option FROM pg_auth_members
        WHERE roleid = 'content_reader'::regrole AND member = 'content_reader_staging'::regrole`,
    );
    expect(membership?.inherit_option).toBe(true);
    const reader = {
      name: "content_reader_staging",
      password: secondPasswords.CONTENT_READER_DB_PASSWORD ?? "",
    };
    const [setting] = await query<{ default_transaction_read_only: string }>(
      urlFor("content_staging", reader),
      "SHOW default_transaction_read_only",
    );
    expect(setting?.default_transaction_read_only).toBe("on");
  });

  it("creates vector in agent_staging only", async () => {
    for (const [database, expected] of [
      ["agent_staging", ["vector"]],
      ["content_staging", []],
      ["contact_staging", []],
    ] as const) {
      const rows = await query<{ extname: string }>(
        urlFor(database),
        "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
      );
      expect(rows.map((row) => row.extname)).toEqual(expected);
    }
  });

  it("leaves PUBLIC without CONNECT, so a service role cannot open another service's database", async () => {
    const rows = await query<{ datname: string; public_connect: boolean }>(
      urlFor(container.getDatabase()),
      `SELECT datname, has_database_privilege('public', datname, 'CONNECT') AS public_connect
         FROM pg_database WHERE datname LIKE '%\\_staging' ORDER BY datname`,
    );
    expect(rows.every((row) => !row.public_connect)).toBe(true);
    const agent = { name: "agent_staging", password: secondPasswords.AGENT_DB_PASSWORD ?? "" };
    // 42501: insufficient privilege, "permission denied for database content_staging".
    expect(await connectFailure(urlFor("content_staging", agent))).toBe("42501");
    expect(await connectFailure(urlFor("agent_staging", agent))).toBeUndefined();
  });

  it("takes the second run's passwords: the new one logs in, the old one no longer does", async () => {
    const name = "content_staging";
    const fresh = { name, password: secondPasswords.CONTENT_DB_PASSWORD ?? "" };
    const old = { name, password: firstPasswords.CONTENT_DB_PASSWORD ?? "" };
    expect(await connectFailure(urlFor(name, fresh))).toBeUndefined();
    // 28P01: invalid password.
    expect(await connectFailure(urlFor(name, old))).toBe("28P01");
  });

  it("never prints a password", () => {
    for (const password of Object.values(secondPasswords)) {
      expect(secondOutput).not.toContain(password);
    }
  });
});

describe("provision.sql refuses to run half-configured", () => {
  it("stops before any change when a password is missing or empty, naming the variables only", async () => {
    const passwords: Record<string, string> = { ...freshPasswords(), AGENT_DB_PASSWORD: "" };
    delete passwords.CONTACT_DB_PASSWORD;
    const result = await runProvisioning(container, "prod", passwords);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("missing or empty: AGENT_DB_PASSWORD, CONTACT_DB_PASSWORD");
    for (const password of Object.values(passwords).filter(Boolean)) {
      expect(result.output).not.toContain(password);
    }
    const prodRoles = await query(
      urlFor(container.getDatabase()),
      "SELECT rolname FROM pg_roles WHERE rolname LIKE '%\\_prod'",
    );
    expect(prodRoles).toEqual([]);
  });

  it("refuses an environment it does not know", async () => {
    const result = await runProvisioning(container, "qa" as "dev", freshPasswords());
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("env must be dev, staging, prod or ops");
  });
});

// A deploy converges only its own service's roles (WP-9 D4, rotation ordering), on env=dev here so
// the staging runs above and the prod refusal stay untouched.
describe("provision.sql with service set", () => {
  it("converges only api's roles and database, needing only api's passwords", async () => {
    const { CONTENT_DB_PASSWORD = "", CONTENT_READER_DB_PASSWORD = "" } = freshPasswords();
    const result = await runProvisioning(
      container,
      "dev",
      { CONTENT_DB_PASSWORD, CONTENT_READER_DB_PASSWORD },
      "api",
    );
    expect(result.exitCode, result.output).toBe(0);
    const admin = urlFor(container.getDatabase());
    const roles = await query<{ rolname: string }>(
      admin,
      "SELECT rolname FROM pg_roles WHERE rolname LIKE '%\\_dev' ORDER BY rolname",
    );
    expect(roles.map((row) => row.rolname)).toEqual(["content_dev", "content_reader_dev"]);
    const databases = await query<{ datname: string }>(
      admin,
      "SELECT datname FROM pg_database WHERE datname LIKE '%\\_dev' ORDER BY datname",
    );
    expect(databases.map((row) => row.datname)).toEqual(["content_dev"]);
  });

  it("re-passwords only the named service: agent's run leaves api's roles as they were", async () => {
    const all = freshPasswords();
    expect((await runProvisioning(container, "dev", all)).exitCode).toBe(0);
    const agentPassword = randomBytes(16).toString("hex");
    const run = await runProvisioning(
      container,
      "dev",
      { AGENT_DB_PASSWORD: agentPassword },
      "agent",
    );
    expect(run.exitCode, run.output).toBe(0);
    expect(run.output).not.toContain(agentPassword);
    const agent = urlFor("agent_dev", { name: "agent_dev", password: agentPassword });
    expect(await connectFailure(agent)).toBeUndefined();
    const content = urlFor("content_dev", {
      name: "content_dev",
      password: all.CONTENT_DB_PASSWORD ?? "",
    });
    expect(await connectFailure(content)).toBeUndefined();
  });

  it("names only the missing passwords of the service it converges", async () => {
    const result = await runProvisioning(
      container,
      "dev",
      { CONTENT_DB_PASSWORD: randomBytes(16).toString("hex") },
      "api",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("missing or empty: CONTENT_READER_DB_PASSWORD");
    expect(result.output).not.toContain("AGENT_DB_PASSWORD");
  });

  it("refuses a service it does not know, and a service on env=ops", async () => {
    const unknown = await runProvisioning(container, "dev", freshPasswords(), "web" as "api");
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.output).toContain("service must be api, agent or contact");
    const ops = await runProvisioning(
      container,
      "ops",
      { UMAMI_DB_PASSWORD: randomBytes(16).toString("hex") },
      "api",
    );
    expect(ops.exitCode).not.toBe(0);
    expect(ops.output).toContain("service applies to dev, staging and prod only");
  });
});

describe("provision.sql with env=ops", () => {
  it("converges only Umami's role and database, closed to PUBLIC", async () => {
    const password = randomBytes(16).toString("hex");
    for (let run = 0; run < 2; run += 1) {
      const result = await runProvisioning(container, "ops", { UMAMI_DB_PASSWORD: password });
      expect(result.exitCode, result.output).toBe(0);
    }
    const [umami] = await query<{ owner: string; public_connect: boolean }>(
      urlFor(container.getDatabase()),
      `SELECT datdba::regrole::text AS owner,
              has_database_privilege('public', 'umami', 'CONNECT') AS public_connect
         FROM pg_database WHERE datname = 'umami'`,
    );
    expect(umami).toEqual({ owner: "umami", public_connect: false });
    expect(await connectFailure(urlFor("umami", { name: "umami", password }))).toBeUndefined();
  });
});

// infra/postgres/pg_hba.conf as the server loads it (compose.ops.yml: mounted read-only and named
// with `-c hba_file`): Postgres parses every line at boot and lists any it cannot read in
// pg_hba_file_rules, so a typo shows here instead of as a refused login on the server.
describe("pg_hba.conf loaded as the server's hba_file", () => {
  const HBA_FILE = fileURLToPath(new URL("../../../infra/postgres/pg_hba.conf", import.meta.url));
  const HBA_IN_CONTAINER = "/etc/postgresql/pg_hba.conf";
  let server: StartedPostgreSqlContainer;

  /** Runs one query as the superuser over the socket (peer), as provisioning and backups do. */
  async function socketQuery(sql: string): Promise<string> {
    const result = await server.exec(
      ["psql", "--no-psqlrc", "-X", "-At", "-d", "postgres", "-c", sql],
      { user: "postgres" },
    );
    expect(result.exitCode, result.output).toBe(0);
    return result.output.trim();
  }

  beforeAll(async () => {
    useDockerContextHost();
    server = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withUsername("postgres")
      .withDatabase("postgres")
      .withCopyFilesToContainer([{ source: HBA_FILE, target: HBA_IN_CONTAINER, mode: 0o644 }])
      .withCommand(["postgres", "-c", `hba_file=${HBA_IN_CONTAINER}`])
      .start();
  });

  afterAll(async () => {
    await server?.stop();
  });

  it("reads the mounted file, with no line in error", async () => {
    expect(await socketQuery("SHOW hba_file")).toBe(HBA_IN_CONTAINER);
    expect(await socketQuery("SELECT count(*) FROM pg_hba_file_rules")).not.toBe("0");
    expect(
      await socketQuery("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"),
    ).toBe("0");
  });

  it("rejects the superuser over TCP, from an address no line accepts", async () => {
    const url = new URL(server.getConnectionUri());
    // 28000: invalid authorization specification, "pg_hba.conf rejects connection".
    expect(await connectFailure(url.toString())).toBe("28000");
  });
});
