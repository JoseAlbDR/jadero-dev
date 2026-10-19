// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
//
// Tests `infra/rabbitmq/import-definitions.sh`, the live topology import of WP-9 step 4 (ADR-053),
// against a docker stub on PATH: it records each call, keeps the definitions it was fed on stdin,
// and answers `list_queues` from STUB_LISTING_* files, one per poll, so a test controls what the
// broker lists and when. The broker's real behavior is pinned by
// packages/messaging/test/topology-import.int.test.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(REPO, "infra/rabbitmq/import-definitions.sh");
const STAGING = join(REPO, "infra/rabbitmq/server/definitions/staging.json");

// `${` would be interpolated by a template literal, so the stub is plain text.
const DOCKER_STUB = [
  "#!/bin/bash",
  'printf "%s\\n" "$*" >> "$STUB_REC/calls"',
  'if [[ "$*" == *import_definitions* ]]; then',
  '  cat > "$STUB_REC/stdin"',
  '  [[ -n "${STUB_IMPORT_FAILS:-}" ]] && { echo "Error: import refused" >&2; exit 1; }',
  "  exit 0",
  "fi",
  'if [[ "$*" == *list_queues* ]]; then',
  '  n=$(cat "$STUB_REC/polls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_REC/polls"',
  '  file="$STUB_REC/listing-$n"; [[ -f "$file" ]] || file="$STUB_REC/listing"',
  '  [[ -f "$file" ]] && cat "$file"',
  "  exit 0",
  "fi",
  "exit 0",
].join("\n");

let root;
let stubDir;
let run = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), "import-definitions-"));
  stubDir = join(root, "bin");
  mkdirSync(stubDir);
  writeFileSync(join(stubDir, "docker"), `${DOCKER_STUB}\n`);
  chmodSync(join(stubDir, "docker"), 0o755);
});

after(() => rmSync(root, { recursive: true, force: true }));

/** The queues of the committed staging file, as `list_queues name type` prints them. */
const stagingQueues = () =>
  JSON.parse(readFileSync(STAGING, "utf8")).queues.map((q) => [
    q.name,
    q.arguments["x-queue-type"],
  ]);
const listing = (rows) => rows.map(([name, type]) => `${name}\t${type}\n`).join("");

/**
 * Runs the script once in a fresh folder.
 * @param {{ args?: string[], definitions?: object, listings?: string[], env?: object }} options
 *   the arguments, the staging file to use (default: the committed one), what each poll lists
 *   (the last one repeats), extra variables
 * @returns {{ status: number | null, output: string, rec: string }} the result
 */
function importDefinitions({ args = ["staging"], definitions, listings = [], env = {} } = {}) {
  run += 1;
  const rec = join(root, `run-${run}`);
  const folder = join(rec, "definitions");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "staging.json"),
    definitions ? JSON.stringify(definitions) : readFileSync(STAGING, "utf8"),
  );
  for (const [i, text] of listings.entries()) writeFileSync(join(rec, `listing-${i + 1}`), text);
  if (listings.length > 0) writeFileSync(join(rec, "listing"), listings.at(-1));
  const result = spawnSync("bash", [SCRIPT, ...args], {
    env: {
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_REC: rec,
      RABBITMQ_CONTAINER: "jadero-ops-rabbitmq-1",
      RABBITMQ_DEFINITIONS: folder,
      RABBITMQ_IMPORT_TIMEOUT: "2",
      ...env,
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, rec };
}

const calls = (rec) =>
  existsSync(join(rec, "calls")) ? readFileSync(join(rec, "calls"), "utf8").trim().split("\n") : [];

describe("import-definitions.sh", () => {
  it("imports the file on stdin, then polls until every queue is listed with its type", () => {
    const all = stagingQueues();
    const run = importDefinitions({ listings: ["", listing(all.slice(0, 2)), listing(all)] });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, new RegExp(`${all.length} queues on /staging listed`));
    assert.equal(readFileSync(join(run.rec, "stdin"), "utf8"), readFileSync(STAGING, "utf8"));
    const made = calls(run.rec);
    assert.equal(made[0], "exec -i jadero-ops-rabbitmq-1 rabbitmqctl import_definitions");
    assert.deepEqual(
      made.slice(1),
      Array(3).fill(
        "exec jadero-ops-rabbitmq-1 rabbitmqctl --quiet list_queues -p /staging --no-table-headers name type",
      ),
    );
  });

  it("fails after the bounded wait when a queue never shows up, naming the count only", () => {
    const run = importDefinitions({ listings: [listing(stagingQueues().slice(1))] });
    assert.equal(run.status, 1);
    assert.match(run.output, /1 of \d+ queues on \/staging not listed after 2s/);
  });

  it("refuses a queue listed with another type: a type never changes in place", () => {
    const rows = stagingQueues().map(([name, type]) =>
      name === "agent.system.ping" ? [name, "classic"] : [name, type],
    );
    const run = importDefinitions({ listings: [listing(rows)] });
    assert.equal(run.status, 1);
    assert.match(
      run.output,
      /queue agent\.system\.ping on \/staging is classic, the definitions say quorum/,
    );
    assert.equal(calls(run.rec).filter((c) => c.includes("list_queues")).length, 1, "at once");
  });

  it("stops when the import itself fails, showing rabbitmqctl's error", () => {
    const run = importDefinitions({ env: { STUB_IMPORT_FAILS: "1" } });
    assert.equal(run.status, 1);
    assert.match(run.output, /import refused/);
    assert.ok(!calls(run.rec).some((c) => c.includes("list_queues")));
  });

  it("refuses a file that reaches another vhost or carries users, before calling the broker", () => {
    const base = JSON.parse(readFileSync(STAGING, "utf8"));
    const cases = [
      { ...base, users: [{ name: "x" }] },
      { ...base, vhosts: [{ name: "/prod" }] },
      { ...base, policies: base.policies.map((p) => ({ ...p, vhost: "/prod" })) },
      { ...base, queues: [] },
    ];
    for (const definitions of cases) {
      const run = importDefinitions({ definitions });
      assert.equal(run.status, 1, run.output);
      assert.deepEqual(calls(run.rec), [], "the broker was never called");
    }
  });

  it("refuses bad words and a missing container", () => {
    for (const [args, env] of [
      [[], {}],
      [["dev"], {}],
      [["staging", "extra"], {}],
      [["staging"], { RABBITMQ_CONTAINER: "" }],
      [["staging"], { RABBITMQ_IMPORT_TIMEOUT: "0" }],
      [["staging"], { RABBITMQ_IMPORT_TIMEOUT: "1;id" }],
    ]) {
      const run = importDefinitions({ args, env });
      assert.equal(run.status, 2, `${args} ${JSON.stringify(env)}: ${run.output}`);
      assert.deepEqual(calls(run.rec), []);
    }
  });
});
