// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
//
// Tests `infra/scripts/smoke-deploy.sh`, the deploy's smoke checks (WP-9 D7), with curl and
// docker stubs on PATH: curl answers 200 unless the URL holds a STUB_DOWN word (then 502), docker
// fails a container probe named in STUB_DOWN and answers the heartbeat SELECT from ping-<n> files,
// one per poll (the last repeats). Nothing reaches a server, a container or the network.
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
const SCRIPT = join(REPO, "infra/scripts/smoke-deploy.sh");
const SINCE = 1_800_000_000;

const CURL_STUB = [
  "#!/bin/bash",
  'printf "%s\\n" "$*" >> "$STUB_REC/curl-calls"',
  'url="${*: -1}"',
  'for word in ${STUB_DOWN:-}; do [[ "$url" == *"$word"* ]] && { printf 502; exit 0; }; done',
  "printf 200",
].join("\n");

const DOCKER_STUB = [
  "#!/bin/bash",
  'printf "%s\\n" "$*" >> "$STUB_REC/docker-calls"',
  'if [[ "$*" == *psql* ]]; then',
  '  cat > "$STUB_REC/psql-stdin"',
  '  n=$(cat "$STUB_REC/polls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_REC/polls"',
  '  file="$STUB_REC/ping-$n"; [[ -f "$file" ]] || file="$STUB_REC/ping"',
  '  [[ -f "$file" ]] && { echo BEGIN; cat "$file"; echo COMMIT; }',
  "  exit 0",
  "fi",
  'for word in ${STUB_DOWN:-}; do [[ "$*" == *"$word"* ]] && exit 1; done',
  "exit 0",
].join("\n");

let root;
let stubDir;
let run = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), "smoke-deploy-"));
  stubDir = join(root, "bin");
  mkdirSync(stubDir);
  for (const [name, body] of [
    ["curl", CURL_STUB],
    ["docker", DOCKER_STUB],
  ]) {
    writeFileSync(join(stubDir, name), `${body}\n`);
    chmodSync(join(stubDir, name), 0o755);
  }
});

after(() => rmSync(root, { recursive: true, force: true }));

/**
 * Runs the smoke once.
 * @param {string[]} args env, service, since, deployed
 * @param {{ pings?: number[], down?: string, env?: object }} [options] the heartbeat each poll
 *   reads (the last repeats; none: no row), what is down, extra variables
 * @returns {{ status: number | null, stdout: string, rec: string }} the result
 */
function smoke(args, { pings = [SINCE + 5], down = "", env = {} } = {}) {
  run += 1;
  const rec = join(root, `run-${run}`);
  mkdirSync(rec);
  pings.forEach((seen, i) => {
    writeFileSync(join(rec, `ping-${i + 1}`), `${seen}\n`);
  });
  if (pings.length > 0) writeFileSync(join(rec, "ping"), `${pings.at(-1)}\n`);
  const result = spawnSync("bash", [SCRIPT, ...args], {
    env: {
      PATH: `${stubDir}:/usr/bin:/bin`,
      STUB_REC: rec,
      STUB_DOWN: down,
      SMOKE_PING_TIMEOUT: "2",
      SMOKE_PING_INTERVAL: "1",
      ...env,
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, rec };
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const calls = (rec, tool) =>
  read(join(rec, `${tool}-calls`))
    .split("\n")
    .filter(Boolean);
/** The result lines as { check: result }. */
const results = (stdout) =>
  Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^check=(\w+) result=(ok|skipped|failed)$/);
        assert.ok(match, `a result line and nothing else: ${line}`);
        return [match[1], match[2]];
      }),
  );
const all = (service, env = "staging") => [env, service, String(SINCE), "api,agent,web"];

describe("smoke-deploy.sh, each check gates only its path", () => {
  it("runs every check for api: ready, pages, content and ping", () => {
    const r = smoke(all("api"));
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(results(r.stdout), { ready: "ok", pages: "ok", content: "ok", ping: "ok" });
    const urls = calls(r.rec, "curl").map((c) => c.split(" ").at(-1));
    assert.deepEqual(urls, [
      "http://127.0.0.1:3121/health/ready",
      "https://new.jadero.dev/es/",
      "https://new.jadero.dev/en/",
      "https://new.jadero.dev/de/",
      "https://new.jadero.dev/api/v1/content/en/projects",
    ]);
    // Through the edge, connected to this host: nginx, TLS and routing, no DNS.
    for (const call of calls(r.rec, "curl").slice(1)) {
      assert.match(call, /--resolve new\.jadero\.dev:443:127\.0\.0\.1 /);
    }
    assert.ok(
      urls.every((url) => !url.includes("?")),
      "no query string",
    );
    // The worker publishes nothing: its own probe, on 127.0.0.1 inside the container.
    assert.match(
      calls(r.rec, "docker")[0],
      /^exec jadero-staging-api-worker-1 node -e fetch\('http:\/\/127\.0\.0\.1:'/,
    );
  });

  it("runs ready and pages for web, never the broker path", () => {
    const r = smoke(all("web"));
    assert.equal(r.status, 0);
    assert.deepEqual(results(r.stdout), { ready: "ok", pages: "ok" });
    assert.equal(calls(r.rec, "curl")[0].split(" ").at(-1), "http://127.0.0.1:3120/robots.txt");
    assert.deepEqual(calls(r.rec, "docker"), [], "no heartbeat read for web");
  });

  it("runs ready and ping for agent, never a page", () => {
    const r = smoke(all("agent"));
    assert.equal(r.status, 0);
    assert.deepEqual(results(r.stdout), { ready: "ok", ping: "ok" });
    assert.deepEqual(calls(r.rec, "curl"), []);
    const docker = calls(r.rec, "docker");
    assert.ok(docker.some((c) => c.startsWith("exec jadero-staging-agent-1 node")));
    assert.ok(docker.some((c) => c.startsWith("exec jadero-staging-agent-consumer-1 node")));
  });

  it("fails a deploy only on its own path: web down fails api, not agent", () => {
    const api = smoke(all("api"), { down: "new.jadero.dev/es" });
    assert.equal(api.status, 1);
    assert.equal(results(api.stdout).pages, "failed");
    const agent = smoke(all("agent"), { down: "new.jadero.dev" });
    assert.equal(agent.status, 0, "a broken page never rolls back agent");
    const worker = smoke(all("api"), { down: "api-worker" });
    assert.equal(worker.status, 1);
    assert.equal(results(worker.stdout).ready, "failed");
  });

  it("uses 127.0.0.1 on production, no public host until the cutover", () => {
    const r = smoke(all("api", "prod"));
    assert.equal(r.status, 0);
    assert.deepEqual(
      calls(r.rec, "curl").map((c) => c.split(" ").at(-1)),
      [
        "http://127.0.0.1:3111/health/ready",
        "http://127.0.0.1:3110/es/",
        "http://127.0.0.1:3110/en/",
        "http://127.0.0.1:3110/de/",
        "http://127.0.0.1:3111/v1/content/en/projects",
      ],
    );
    assert.ok(!calls(r.rec, "curl").some((c) => c.includes("new.jadero.dev")));
    assert.ok(calls(r.rec, "docker").some((c) => c.includes("jadero-prod-api-worker-1")));
  });

  it("keeps the ports equal to the overlays' 127.0.0.1 binds", () => {
    const source = read(SCRIPT);
    for (const env of ["staging", "prod"]) {
      const overlay = read(join(REPO, `infra/compose/compose.${env}.yml`));
      const web = overlay.match(/127\.0\.0\.1:(\d+):3000/)[1];
      const api = overlay.match(/127\.0\.0\.1:(\d+):3001/)[1];
      assert.match(source, new RegExp(`${env}\\) readonly WEB_PORT=${web} API_PORT=${api} ;;`));
    }
  });
});

describe("smoke-deploy.sh, the first round of an environment", () => {
  it("skips ping on agent's first deploy (no api yet) and passes", () => {
    const r = smoke(["staging", "agent", String(SINCE), "agent"]);
    assert.equal(r.status, 0);
    assert.deepEqual(results(r.stdout), { ready: "ok", ping: "skipped" });
    assert.ok(!calls(r.rec, "docker").some((c) => c.includes("psql")));
  });

  it("skips pages but checks content and the ping on api's first deploy after agent", () => {
    const r = smoke(["staging", "api", String(SINCE), "api,agent"]);
    assert.equal(r.status, 0);
    assert.deepEqual(results(r.stdout), {
      ready: "ok",
      pages: "skipped",
      content: "ok",
      ping: "ok",
    });
  });
});

describe("smoke-deploy.sh, the ping window", () => {
  it("reads only the heartbeat's timestamp, in a read-only transaction, in agent's database", () => {
    const r = smoke(all("agent"));
    const psql = calls(r.rec, "docker").find((c) => c.includes("psql"));
    assert.equal(
      psql,
      "exec -i -u postgres jadero-ops-postgres-1 psql -X -q -At -v ON_ERROR_STOP=1 -d agent_staging",
    );
    const sql = read(join(r.rec, "psql-stdin"));
    assert.match(sql, /^BEGIN TRANSACTION READ ONLY;$/m);
    assert.match(
      sql,
      /^SELECT floor\(extract\(epoch FROM last_seen_at\)\)::bigint FROM heartbeat\.broker_heartbeat WHERE source = 'jadero\/api';$/m,
    );
  });

  it("waits for a heartbeat newer than the moment up --wait returned", () => {
    const r = smoke(all("agent"), { pings: [SINCE - 30, SINCE, SINCE + 1] });
    assert.equal(r.status, 0);
    assert.equal(read(join(r.rec, "polls")).trim(), "3", "an old or equal one never counts");
  });

  it("fails after the bounded wait when no newer heartbeat arrives, or none at all", () => {
    for (const pings of [[SINCE], []]) {
      const r = smoke(all("api"), { pings });
      assert.equal(r.status, 1);
      assert.equal(results(r.stdout).ping, "failed");
    }
  });
});

describe("smoke-deploy.sh, refused words", () => {
  for (const args of [
    [],
    ["dev", "api", String(SINCE), "api"],
    ["staging", "contact", String(SINCE), "api"],
    ["staging", "api", "yesterday", "api"],
    ["staging", "api", String(SINCE), "agent"],
    ["staging", "api", String(SINCE), "api;id"],
  ]) {
    it(`refuses ${JSON.stringify(args)} before any check`, () => {
      const r = smoke(args);
      assert.equal(r.status, 2);
      assert.deepEqual(calls(r.rec, "curl"), []);
      assert.deepEqual(calls(r.rec, "docker"), []);
    });
  }
});
