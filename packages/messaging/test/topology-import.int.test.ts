import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { useDockerContextHost } from "@jadero/testing";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RABBITMQ_IMAGE } from "./setup/images.js";

// The live topology import of a deploy (WP-9 step 4, ADR-053 "Topology per service deploy"),
// against the servers' broker as server-provisioning.int.test.ts builds it: the pinned image
// booted with the per-vhost definitions, the staging users converged. Each import runs the real
// infra/rabbitmq/import-definitions.sh, as deploy.sh runs it from a release's files. The monotonic
// guard that decides whether to import is deploy.sh's (scripts/deploy.test.mjs); this file pins
// the broker behavior that makes the guard necessary.

const INFRA = (path: string) => fileURLToPath(new URL(`../../../infra/${path}`, import.meta.url));
const IMPORT = INFRA("rabbitmq/import-definitions.sh");
const PROVISION = INFRA("rabbitmq/provision-users.sh");
const COMMITTED = INFRA("rabbitmq/server/definitions/staging.json");

type Definitions = {
  queues: { name: string; vhost: string; arguments: Record<string, unknown> }[];
  policies: { name: string; definition: Record<string, unknown> }[];
};

/** The committed staging definitions, parsed fresh for each change a test makes. */
const committed = (): Definitions => JSON.parse(readFileSync(COMMITTED, "utf8")) as Definitions;

/** Test-only passwords of the staging users, hex only, never printed. */
const PASSWORDS = Object.fromEntries(
  ["api_staging", "agent_staging", "ops_admin"].map((user) => [
    user,
    randomBytes(16).toString("hex"),
  ]),
);

let container: StartedTestContainer;
let scratch: string;

/** Runs rabbitmqctl in the broker and returns its output, failing the test on a non-zero exit. */
async function ctl(...args: string[]): Promise<string> {
  const result = await container.exec(["rabbitmqctl", "--quiet", ...args]);
  expect(result.exitCode, result.output).toBe(0);
  return result.output;
}

/** The queues of /staging as `name -> type`. */
async function queueTypes(): Promise<Record<string, string>> {
  const output = await ctl("list_queues", "-p", "/staging", "--no-table-headers", "name", "type");
  return Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t") as [string, string]),
  );
}

/** The delivery limit the policy of agent.system.ping sets, polled until it equals `expected`. */
async function deliveryLimitBecomes(expected: number): Promise<number | undefined> {
  let limit: number | undefined;
  for (let i = 0; i < 40; i++) {
    const output = await ctl("list_policies", "-p", "/staging", "--no-table-headers");
    const row = output.split("\n").find((line) => line.split("\t")[1] === "agent.system.ping");
    limit = row ? (JSON.parse(row.split("\t")[4] ?? "{}")["delivery-limit"] as number) : undefined;
    if (limit === expected) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return limit;
}

/**
 * Runs import-definitions.sh on /staging with a definitions document, as a release would carry it.
 * @param definitions the document; the committed file when left out.
 * @returns the exit code and the combined output.
 */
function importRelease(definitions?: Definitions) {
  const folder = mkdtempSync(join(scratch, "release-"));
  writeFileSync(
    join(folder, "staging.json"),
    definitions ? JSON.stringify(definitions) : readFileSync(COMMITTED, "utf8"),
  );
  const result = spawnSync("bash", [IMPORT, "staging"], {
    env: {
      ...process.env,
      RABBITMQ_CONTAINER: container.getId(),
      RABBITMQ_DEFINITIONS: folder,
      RABBITMQ_IMPORT_TIMEOUT: "30",
    },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The next release's staging file: one more queue, and a changed policy. */
function nextRelease(): Definitions {
  const next = committed();
  next.queues.push({
    name: "agent.content.published",
    vhost: "/staging",
    arguments: { "x-queue-type": "quorum" },
  } as Definitions["queues"][number]);
  for (const policy of next.policies) {
    if (policy.name === "agent.system.ping") policy.definition["delivery-limit"] = 10;
  }
  return next;
}

beforeAll(async () => {
  useDockerContextHost();
  scratch = mkdtempSync(join(tmpdir(), "topology-import-"));
  mkdirSync(scratch, { recursive: true });
  container = await new GenericContainer(RABBITMQ_IMAGE)
    .withCopyFilesToContainer([
      {
        source: INFRA("rabbitmq/server/rabbitmq.conf"),
        target: "/etc/rabbitmq/conf.d/20-jadero.conf",
      },
    ])
    .withCopyDirectoriesToContainer([
      { source: INFRA("rabbitmq/server/definitions"), target: "/etc/rabbitmq/definitions" },
    ])
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .withStartupTimeout(120_000)
    .start();
  const provision = spawnSync(PROVISION, ["staging"], {
    env: {
      ...process.env,
      RABBITMQ_CONTAINER: container.getId(),
      ...Object.fromEntries(
        Object.entries(PASSWORDS).map(([user, pw]) => [
          `RABBITMQ_${user.toUpperCase()}_PASSWORD`,
          pw,
        ]),
      ),
    },
    encoding: "utf8",
  });
  expect(provision.status, `${provision.stdout}${provision.stderr}`).toBe(0);
}, 180_000);

afterAll(async () => {
  await container?.stop();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("the live topology import of a deploy", () => {
  it("adds the next release's queue and policy, and keeps the users and their rights", async () => {
    const users = await ctl("list_users", "--no-table-headers");
    const rights = await ctl("list_permissions", "-p", "/staging", "--no-table-headers");

    const run = importRelease(nextRelease());
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain(`${nextRelease().queues.length} queues on /staging listed`);

    expect((await queueTypes())["agent.content.published"]).toBe("quorum");
    expect(await deliveryLimitBecomes(10)).toBe(10);
    // The import never touches users: same users, same rights, the same password still works.
    expect(await ctl("list_users", "--no-table-headers")).toBe(users);
    expect(await ctl("list_permissions", "-p", "/staging", "--no-table-headers")).toBe(rights);
    const auth = await container.exec([
      "rabbitmqctl",
      "authenticate_user",
      "agent_staging",
      PASSWORDS.agent_staging ?? "",
    ]);
    expect(auth.exitCode).toBe(0);
    for (const pw of Object.values(PASSWORDS)) expect(run.output).not.toContain(pw);
  });

  it("lets an older file revert a policy but delete nothing: why deploy.sh guards the version", async () => {
    // What a rollback release would do without the guard: the committed (older) file again.
    const run = importRelease();
    expect(run.status, run.output).toBe(0);
    // The policy goes back to the older value at once: a rollback would undo a newer setting.
    expect(await deliveryLimitBecomes(20)).toBe(20);
    // The additive part holds: the newer queue stays (removing one is a manual contract step).
    expect((await queueTypes())["agent.content.published"]).toBe("quorum");
  });

  it("keeps a queue's type when a file redeclares it, so the script refuses the import", async () => {
    const changed = committed();
    for (const queue of changed.queues) {
      if (queue.name === "agent.system.ping") queue.arguments = { "x-queue-type": "classic" };
    }
    // RabbitMQ 4.3.6 itself: the import is accepted (exit 0, no error) and the queue silently
    // keeps its old type.
    const raw = spawnSync(
      "docker",
      ["exec", "-i", container.getId(), "rabbitmqctl", "import_definitions"],
      { input: JSON.stringify(changed), encoding: "utf8" },
    );
    expect(raw.status, `${raw.stdout}${raw.stderr}`).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect((await queueTypes())["agent.system.ping"]).toBe("quorum");

    // The deploy's import compares the listed type with the file's and fails, so the deploy rolls
    // back instead of starting a consumer on a queue that is not what its release declares.
    const run = importRelease(changed);
    expect(run.status).toBe(1);
    expect(run.output).toContain(
      "queue agent.system.ping on /staging is quorum, the definitions say classic",
    );
  });
}, 300_000);
