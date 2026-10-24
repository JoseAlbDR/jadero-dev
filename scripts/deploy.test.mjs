// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
//
// Tests `infra/scripts/deploy.sh`, the deploy state machine of WP-9 D1, D3 and D4. The script reads
// no path from the environment, so each test copies it into a fresh temporary folder and rewrites
// its PATH line and its two root paths (state, op token); the lock lives in the state folder. docker, op and git are stubs on
// that PATH that record their calls and act on STUB_* variables; the git stub serves this
// repository's own infra/ and packages/messaging/package.json (plus a stub smoke script) as the
// release tag's files, and the docker stub lists the queues of the last definitions imported, so
// the release's real import-definitions.sh and provision-users.sh run against it. On a machine without util-linux's flock (macOS) a shim takes the same flock(2) lock
// through perl. Nothing here reaches Docker, 1Password, GitHub or a server.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DEPLOY_SH = join(REPO, "infra/scripts/deploy.sh");
const REPO_PREFIX = "ghcr.io/josealbdr/jadero-dev-";
const INERT = "jadero.invalid/not-deployed";
const OLD = "1".repeat(64);
const NEW = "2".repeat(64);
const OLDER = "0".repeat(64);
const COMMIT = "c".repeat(40);
// What op "renders" for every reference: a password that must never leave the env file.
const SECRET = "Canary0Secret0Value";
// What the docker stub prints on every compose, login and pull call, as `docker compose config`
// would print the rendered secrets.
const COMPOSE_CANARY = "ComposeConfigCanary4242";
const OP_TOKEN = "ops_tokenValueNeverPrinted";
// The messaging version of this checkout, which the fixture's release carries.
const MESSAGING = JSON.parse(
  readFileSync(join(REPO, "packages/messaging/package.json"), "utf8"),
).version;
const STATES = [
  "checked",
  "fetched",
  "rendered",
  "pulled",
  "provisioned",
  "migrated",
  "started",
  "verified",
  "recorded",
];

let root;
let stubDir;
let fixture;
let mismatchFixture;
let run = 0;

/**
 * Writes an executable bash script.
 * @param {string} path the absolute path
 * @param {string} body the script body after the shebang
 */
function writeScript(path, body) {
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/**
 * Replaces one line of the script that matches a pattern, and fails when none does, so a renamed
 * constant can never leave a production path in the copy under test.
 * @param {string} source the script text
 * @param {RegExp} line the line to replace
 * @param {string} replacement the new line
 * @returns {string} the rewritten script
 */
function rewriteLine(source, line, replacement) {
  assert.match(source, line, `deploy.sh has ${line}`);
  return source.replace(line, replacement);
}

/**
 * A bash script body from a template literal, read raw: `@{` stands for bash's `${`, which a
 * template literal would interpolate.
 * @param {TemplateStringsArray} strings the literal's parts
 * @returns {string} the script body
 */
const bash = (strings) => String.raw({ raw: strings.raw }).replaceAll("@{", "${");

const DOCKER_STUB = bash`
rec="$STUB_REC"
printf '%s\n' "$*" >> "$rec/docker-calls"
fails() { [[ " @{STUB_FAIL-} " == *" $1 "* ]]; }
canary() { echo "out $STUB_CANARY"; echo "err $STUB_CANARY" >&2; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
case "$1" in
  login)
    canary
    cat > "$rec/login-stdin"
    printf '%s\n' "@{DOCKER_CONFIG-}" > "$rec/login-config"
    fails login && exit 1
    exit 0 ;;
  pull)
    canary
    [[ -n "@{DOCKER_CONFIG-}" && -d "$DOCKER_CONFIG" ]] || exit 1
    fails pull && exit 1
    exit 0 ;;
  image)
    case "$2" in
      inspect)
        ref="@{@: -1}"
        if [[ "$*" == *RepoDigests* ]]; then
          echo "@{ref%:*}@sha256:$STUB_DIGEST"
        elif [[ "$*" == *revision* ]]; then
          echo "$STUB_REVISION"
        else
          fails no-image && exit 1
        fi
        exit 0 ;;
      ls) for image in @{STUB_IMAGES-}; do echo "$image"; done; exit 0 ;;
      rm) exit 0 ;;
    esac ;;
  exec)
    shift
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -e) name="$2"; printf '%s=%s\n' "$name" "@{!name-}" >> "$rec/exec-env"; shift 2 ;;
        -i) shift ;;
        -u) shift 2 ;;
        *) break ;;
      esac
    done
    if [[ "$*" == *psql* ]]; then
      cat > /dev/null
      fails psql && exit 1
    elif [[ "$*" == *import_definitions* ]]; then
      cat > "$rec/rabbit-import"
      fails import && exit 1
    elif [[ "$*" == *list_queues* ]]; then
      [[ -f "$rec/rabbit-import" ]] || exit 0
      python3 -I -c 'import json, sys
for queue in json.load(open(sys.argv[1]))["queues"]:
    print(queue["name"] + "\tquorum")' "$rec/rabbit-import"
    elif [[ "$*" == *change_password* || "$*" == *add_user* ]]; then
      cat >> "$rec/rabbit-stdin"
      fails broker && exit 1
    fi
    exit 0 ;;
  compose)
    canary
    profile="" sub=""
    args=("$@")
    for ((i = 0; i < @{#args[@]}; i++)); do
      [[ "@{args[$i]}" == --profile ]] && profile="@{args[$((i + 1))]}"
      case "@{args[$i]}" in run | up | config | stop) [[ -z "$sub" ]] && sub="@{args[$i]}" ;; esac
    done
    var="$(upper "$profile")_IMAGE"
    image="@{!var-}"
    printf 'JADERO_ENV=%s API_IMAGE=%s AGENT_IMAGE=%s WEB_IMAGE=%s COMPOSE_PROJECT_NAME=%s :: %s\n' \
      "@{JADERO_ENV-}" "@{API_IMAGE-}" "@{AGENT_IMAGE-}" "@{WEB_IMAGE-}" \
      "@{COMPOSE_PROJECT_NAME-}" "$*" >> "$rec/compose-calls"
    case "$sub" in
      run)
        # What compose run does with a terminal on stdin: it sets the terminal's mode, which
        # stops a background process group (SIGTTOU). deploy.sh must hand it no terminal.
        # Its process group goes to run-pgid first, so a test can kill what stopped.
        if [[ -t 0 ]]; then
          echo tty >> "$rec/run-stdin"
          ps -o pgid= -p $$ > "$rec/run-pgid"
          stty -echo
        else
          echo no-tty >> "$rec/run-stdin"
        fi
        fails migrate && exit 1; exit 0 ;;
      stop) fails stop && exit 1; exit 0 ;;
      up)
        if [[ -n "@{STUB_SLOW_UP-}" ]]; then : > "$rec/up-started"; sleep "$STUB_SLOW_UP"; fi
        fails up-all && exit 1
        if fails up && [[ "$image" == *"$STUB_DIGEST" ]]; then exit 1; fi
        date -u +%s > "$rec/up-returned"
        exit 0 ;;
    esac
    exit 0 ;;
esac
exit 0
`;

const OP_STUB = bash`
rec="$STUB_REC"
printf '%s\n' "$*" >> "$rec/op-calls"
printf 'JADERO_ENV=%s CACHE=%s TOKEN=%s\n' "@{JADERO_ENV-}" "@{OP_CACHE-}" "@{OP_SERVICE_ACCOUNT_TOKEN-}" >> "$rec/op-env"
if [[ -t 0 ]]; then echo tty; else echo no-tty; fi > "$rec/op-stdin"
in="" out=""
while [[ $# -gt 0 ]]; do
  case "$1" in -i) in="$2"; shift 2 ;; -o) out="$2"; shift 2 ;; *) shift ;; esac
done
# Like the real op, which starts a caching \`op daemon\` that outlives the render.
if [[ -n "@{STUB_OP_DAEMON-}" ]]; then sleep 30 & echo "$!" > "$rec/op-daemon"; fi
if [[ " @{STUB_FAIL-} " == *" op "* ]]; then
  printf 'DATABASE_URL={{ op://jadero-ops/partial/password }}\n' > "$out"
  exit 1
fi
sed -E "s#\{\{ op://[^}]*\}\}#@{STUB_PASSWORD:-}#g" "$in" > "$out"
if [[ " @{STUB_FAIL-} " == *" unresolved "* ]]; then echo 'X={{ op://left/over }}' >> "$out"; fi
exit 0
`;

const GIT_STUB = bash`
rec="$STUB_REC"
printf '%s\n' "$*" >> "$rec/git-calls"
[[ "$1" == -C ]] && shift 2
case "$1" in
  init) exit 0 ;;
  fetch) [[ " @{STUB_FAIL-} " == *" fetch "* ]] && exit 128; exit 0 ;;
  rev-parse) echo "$STUB_COMMIT" ;;
  archive) COPYFILE_DISABLE=1 tar -c -C "$STUB_FIXTURE" infra packages ;;
esac
`;

// The lookup deploy.sh runs to remove the one-off migrate containers a timed-out run may leave.
const MIGRATE_RUNS_LOOKUP =
  "ps -aq --filter label=com.docker.compose.project=jadero-staging " +
  "--filter label=com.docker.compose.service=api-migrate " +
  "--filter label=com.docker.compose.oneoff=True";

// GNU timeout's interface: records the limit and the command, then runs the command, or, when a
// word of STUB_TIMEOUT is one of the command's words (`fetch`, `inject`, `login`, `pull`,
// `run`), exits as a timeout does without running it: 124, or STUB_TIMEOUT_STATUS (137 after
// the KILL), and moves the fake clock (DATE_STUB) past the limit plus the KILL's 10 s, as the
// real wait would. When a word of STUB_EXIT is one of the command's words, it exits with
// STUB_EXIT_STATUS at once and leaves the clock alone: a command that died on its own (an OOM
// kill is 137). Otherwise it runs the command in its own process group, as the real one does
// (setpgid, the shield against the terminal's SIGHUP). The real one is not on macOS, and a stub
// makes the timeout instant.
const TIMEOUT_STUB = bash`
printf '%s\n' "$*" >> "$STUB_REC/timeout-calls"
[[ "$1" == --kill-after=10 && "$2" =~ ^[1-9][0-9]*$ ]] || exit 125
limit="$2"
shift 2
for word in @{STUB_TIMEOUT-}; do
  if [[ " $* " == *" $word "* ]]; then
    offset="$(cat "$STUB_REC/clock" 2>/dev/null || echo 0)"
    echo "$((offset + limit + 10))" > "$STUB_REC/clock"
    exit "@{STUB_TIMEOUT_STATUS:-124}"
  fi
done
for word in @{STUB_EXIT-}; do
  [[ " $* " == *" $word "* ]] && exit "@{STUB_EXIT_STATUS:-1}"
done
exec perl -e 'setpgrp(0, 0) or exit 125; exec { $ARGV[0] } @ARGV; exit 127' "$@"
`;

// The real date (REAL_DATE, filled in when written), except that `date -u +%s` adds the seconds
// the timeout stub's fake waits moved the clock, so deploy.sh measures a timeout's elapsed time as
// the real wait would make it.
const DATE_STUB = bash`
if [[ "$*" == "-u +%s" && -f "$STUB_REC/clock" ]]; then
  echo "$(($(REAL_DATE -u +%s) + $(cat "$STUB_REC/clock")))"
  exit 0
fi
exec REAL_DATE "$@"
`;

// flock(2) on file descriptor $2, as util-linux's `flock -n <fd>` does. The lock belongs to the
// open file description the caller holds, so it stays after perl exits.
const FLOCK_SHIM = bash`
[[ "$1" == -n ]] || exit 2
exec perl -e 'use Fcntl qw(:flock); open(my $fh, ">&=", $ARGV[0]) or exit 1; flock($fh, LOCK_EX | LOCK_NB) or exit 1; exit 0' "$2"
`;

const SMOKE_STUB = bash`
printf '%s\n' "$*" >> "$STUB_REC/smoke-calls"
[[ " @{STUB_FAIL-} " == *" smoke "* ]] && exit 1
echo "check=ready result=ok"
for name in @{STUB_SKIPPED-}; do echo "check=$name result=skipped"; done
exit 0
`;

/**
 * Copies this repository's deploy files into a fixture folder, as `git archive <tag> infra
 * packages/messaging/package.json` would unpack them, plus a stub smoke script.
 * @param {string} target the fixture folder
 * @param {{ messaging?: string | null }} [options] another messaging version, or null for a
 *   release without the package file
 */
function makeFixture(target, { messaging } = {}) {
  for (const part of ["compose", "env", "postgres", "rabbitmq"]) {
    cpSync(join(REPO, "infra", part), join(target, "infra", part), { recursive: true });
  }
  mkdirSync(join(target, "infra/scripts"), { recursive: true });
  writeScript(join(target, "infra/scripts/smoke-deploy.sh"), SMOKE_STUB);
  if (messaging === null) return;
  const pkg = join(target, "packages/messaging/package.json");
  mkdirSync(join(target, "packages/messaging"), { recursive: true });
  const text = readFileSync(join(REPO, "packages/messaging/package.json"), "utf8");
  writeFileSync(
    pkg,
    messaging ? text.replace(`"version": "${MESSAGING}"`, `"version": "${messaging}"`) : text,
  );
}

/**
 * A fixture whose release carries another messaging version (or none), made once per name.
 * @param {string | null} messaging the version, or null for no package file
 * @returns {string} the fixture folder
 */
function fixtureWith(messaging) {
  const target = join(root, `fixture-messaging-${messaging ?? "none"}`);
  if (!existsSync(target)) makeFixture(target, { messaging });
  return target;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "deploy-sh-"));
  stubDir = join(root, "bin");
  mkdirSync(stubDir);
  writeScript(join(stubDir, "docker"), DOCKER_STUB);
  writeScript(join(stubDir, "op"), OP_STUB);
  writeScript(join(stubDir, "git"), GIT_STUB);
  writeScript(join(stubDir, "timeout"), TIMEOUT_STUB);
  const realDate = spawnSync("sh", ["-c", "command -v date"], { encoding: "utf8" }).stdout.trim();
  writeScript(join(stubDir, "date"), DATE_STUB.replaceAll("REAL_DATE", realDate));
  const hasFlock = spawnSync("sh", ["-c", "command -v flock"]).status === 0;
  if (!hasFlock) writeScript(join(stubDir, "flock"), FLOCK_SHIM);
  fixture = join(root, "fixture");
  makeFixture(fixture);
  mismatchFixture = join(root, "fixture-mismatch");
  makeFixture(mismatchFixture);
  const overlay = join(mismatchFixture, "infra/compose/compose.staging.yml");
  writeFileSync(
    overlay,
    readFileSync(overlay, "utf8").replace("name: jadero-staging", "name: jadero-prod"),
  );
});

after(() => rmSync(root, { recursive: true, force: true }));

/**
 * A fresh state root, lock folder, token file and copy of deploy.sh for one test.
 * @param {{ env?: string, versions?: Record<string, string>, previous?: Record<string, string>,
 *   releases?: string[], envFiles?: string[] }} [state] what is already deployed: the manifest
 *   entries, the release folders on disk (`api-0.2.0`) and the rendered env files (`api`)
 * @returns {object} the paths of this test's world
 */
function world({ env = "staging", versions, previous, releases = [], envFiles = [] } = {}) {
  run += 1;
  const base = join(root, `run-${run}`);
  const stateRoot = join(base, "srv");
  const envDir = join(stateRoot, env);
  const rec = join(base, "rec");
  for (const folder of [envDir, rec]) mkdirSync(folder, { recursive: true });
  const tokenFile = join(base, "op-token");
  writeFileSync(tokenFile, OP_TOKEN, { mode: 0o600 });
  const manifest = (entries) =>
    Object.entries(entries)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("");
  if (versions) writeFileSync(join(envDir, "versions.env"), manifest(versions));
  if (previous) writeFileSync(join(envDir, "previous.env"), manifest(previous));
  for (const release of releases) {
    for (const part of ["infra", "packages"]) {
      cpSync(join(fixture, part), join(envDir, "releases", release, part), { recursive: true });
    }
  }
  for (const service of envFiles) writeFileSync(join(envDir, `${service}.env`), "OLD=1\n");
  let source = readFileSync(DEPLOY_SH, "utf8");
  source = rewriteLine(
    source,
    /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m,
    `PATH='${stubDir}:/usr/bin:/bin:/usr/sbin:/sbin'`,
  );
  source = rewriteLine(source, /^readonly STATE_ROOT=.*$/m, `readonly STATE_ROOT='${stateRoot}'`);
  source = rewriteLine(
    source,
    /^readonly OP_TOKEN_FILE=.*$/m,
    `readonly OP_TOKEN_FILE='${tokenFile}'`,
  );
  const copy = join(base, "deploy.sh");
  writeScript(copy, source.replace(/^#!.*\n/, ""));
  return { base, stateRoot, envDir, rec, script: copy, env };
}

/** The variables the stubs act on, merged with a test's own. */
function stubEnv(w, extra = {}) {
  return {
    PATH: process.env.PATH,
    STUB_REC: w.rec,
    STUB_FIXTURE: fixture,
    STUB_DIGEST: NEW,
    STUB_COMMIT: COMMIT,
    STUB_REVISION: COMMIT,
    STUB_PASSWORD: SECRET,
    STUB_CANARY: COMPOSE_CANARY,
    ...extra,
  };
}

/** Standard input of a deploy: the registry user, its token and, optionally, the digest. */
const input = (digest) => `octocat\nfake-registry-token-123\n${digest ? `sha256:${digest}\n` : ""}`;

/**
 * Runs the test's copy of deploy.sh to completion.
 * @param {object} w the test's world
 * @param {string[]} args the arguments
 * @param {{ env?: Record<string, string>, stdin?: string }} [options] extra variables, stdin
 * @returns {{ status: number | null, stdout: string, stderr: string }} the result
 */
function deploy(w, args, { env = {}, stdin = input() } = {}) {
  const result = spawnSync(w.script, args, {
    env: stubEnv(w, env),
    input: stdin,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const lines = (path) => read(path).split("\n").filter(Boolean);

/** The journal as { version, state, reason } rows, checking each line's shape. */
function journal(w) {
  return lines(join(w.envDir, "deploy.log")).map((line) => {
    const match = line.match(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ (staging|prod) (api|agent|web) (\S+) (\S+) reason=([a-z0-9-]+)$/,
    );
    assert.ok(match, `journal line has the fixed shape: ${line}`);
    return { version: match[3], state: match[4], reason: match[5] };
  });
}
const states = (w) => journal(w).map((row) => row.state);
const calls = (w, tool) => lines(join(w.rec, `${tool}-calls`));
const composeCalls = (w) => lines(join(w.rec, "compose-calls"));

/** A world where api 0.2.0 runs on staging, with its release files and env file on disk. */
const apiAt020 = (extra = {}) =>
  world({
    versions: { API_VERSION: "0.2.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}` },
    releases: ["api-0.2.0"],
    envFiles: ["api"],
    ...extra,
  });

describe("deploy.sh deploy, the happy path", () => {
  it("walks every state, records the new version and keeps the old one as previous", () => {
    const w = apiAt020();
    const images = [OLDER, OLD, NEW].map((d) => `${REPO_PREFIX}api@sha256:${d}`).join(" ");
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_IMAGES: images },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(states(w), STATES);
    assert.ok(journal(w).every((row) => row.version === "0.3.0"));
    // stdout carries the journal lines and nothing else.
    assert.equal(result.stdout, read(join(w.envDir, "deploy.log")));
    // MESSAGING_VERSION came first, written before the topology import (write-ahead).
    assert.equal(
      read(join(w.envDir, "versions.env")),
      `MESSAGING_VERSION=${MESSAGING}\nAPI_VERSION=0.3.0\nAPI_IMAGE=${REPO_PREFIX}api@sha256:${NEW}\n`,
    );
    assert.equal(
      read(join(w.envDir, "previous.env")),
      `API_VERSION=0.2.0\nAPI_IMAGE=${REPO_PREFIX}api@sha256:${OLD}\n`,
    );
    // The env file is the one this run rendered, root's only; no .new file is left.
    const envFile = join(w.envDir, "api.env");
    assert.match(read(envFile), new RegExp(`content_\\$\\{JADERO_ENV\\}:${SECRET}@`));
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    assert.equal(existsSync(join(w.envDir, "api.env.new")), false);
    // The release's files are on disk; only the image older than previous is pruned.
    assert.ok(existsSync(join(w.envDir, "releases/api-0.3.0/infra/compose/compose.services.yml")));
    assert.ok(calls(w, "docker").includes(`image rm ${REPO_PREFIX}api@sha256:${OLDER}`));
    assert.equal(calls(w, "docker").filter((c) => c.startsWith("image rm")).length, 1);
  });

  it("fetches the tag, logs in with a temporary DOCKER_CONFIG it removes, pulls by tag", () => {
    const w = apiAt020();
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    assert.ok(
      calls(w, "git").some((c) =>
        c.endsWith(
          "fetch -q --depth 1 --no-tags https://github.com/JoseAlbDR/jadero-dev.git refs/tags/api-v0.3.0",
        ),
      ),
    );
    assert.equal(read(join(w.rec, "login-stdin")), "fake-registry-token-123");
    const config = read(join(w.rec, "login-config")).trim();
    assert.ok(config.startsWith(w.envDir), "the config folder is on the state filesystem");
    assert.equal(existsSync(config), false, "the temporary DOCKER_CONFIG is gone");
    assert.ok(calls(w, "docker").includes(`pull ${REPO_PREFIX}api:0.3.0`));
    assert.ok(!calls(w, "docker").some((c) => c.includes("fake-registry-token-123")));
    assert.ok(!read(join(w.envDir, "deploy.log")).includes("fake-registry-token-123"));
  });

  it("converges only this service's roles and broker user, the passwords off every argv", () => {
    const w = apiAt020();
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    const docker = calls(w, "docker");
    const psql = docker.find((c) => c.includes("psql"));
    assert.equal(
      psql,
      "exec -i -u postgres -e CONTENT_DB_PASSWORD -e CONTENT_READER_DB_PASSWORD jadero-ops-postgres-1 psql --no-psqlrc --quiet -v env=staging -v service=api -d postgres",
    );
    assert.deepEqual(lines(join(w.rec, "exec-env")), [
      `CONTENT_DB_PASSWORD=${SECRET}`,
      `CONTENT_READER_DB_PASSWORD=${SECRET}`,
    ]);
    // provision-users.sh with the user filter: api_staging only, its password on stdin.
    const passwordCalls = docker.filter((c) => /change_password|add_user/.test(c));
    assert.deepEqual(passwordCalls, [
      "exec -i jadero-ops-rabbitmq-1 rabbitmqctl add_user api_staging",
    ]);
    assert.equal(read(join(w.rec, "rabbit-stdin")), SECRET);
    for (const tool of ["docker", "op", "git"]) {
      assert.ok(!calls(w, tool).some((c) => c.includes(SECRET)), `${tool} argv holds no secret`);
    }
    assert.equal(read(join(w.rec, "op-env")), `JADERO_ENV=staging CACHE=false TOKEN=${OP_TOKEN}\n`);
  });

  it("migrates, then starts api and api-worker by digest on the staging project only", () => {
    const w = apiAt020();
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    const files = `-f ${w.envDir}/releases/api-0.3.0/infra/compose/compose.services.yml -f ${w.envDir}/releases/api-0.3.0/infra/compose/compose.staging.yml`;
    const head = `JADERO_ENV=staging API_IMAGE=${REPO_PREFIX}api@sha256:${NEW} AGENT_IMAGE=${INERT} WEB_IMAGE=${INERT} COMPOSE_PROJECT_NAME= :: compose --project-name jadero-staging --profile api ${files}`;
    assert.deepEqual(composeCalls(w), [
      `${head} run --rm --no-deps -T api-migrate`,
      `${head} up -d --wait --wait-timeout 120 --no-deps api api-worker`,
    ]);
    const [smoke] = calls(w, "smoke");
    assert.match(smoke, /^staging api \d+ api$/, "no other service is deployed on staging yet");
  });

  it("deploys the first service of an environment, filling only the others' images", () => {
    const w = world();
    const result = deploy(w, ["deploy", "staging", "agent", "0.1.0"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(journal(w)[0].reason, "first-deploy");
    assert.deepEqual(states(w), STATES);
    assert.equal(existsSync(join(w.envDir, "previous.env")), false);
    for (const call of composeCalls(w)) {
      assert.match(call, new RegExp(`AGENT_IMAGE=${REPO_PREFIX}agent@sha256:${NEW} `));
      assert.match(call, new RegExp(`API_IMAGE=${INERT} .*WEB_IMAGE=${INERT} `));
    }
    assert.ok(composeCalls(w).at(-1).endsWith("--no-deps agent agent-consumer"));
    assert.deepEqual(lines(join(w.rec, "exec-env")), [`AGENT_DB_PASSWORD=${SECRET}`]);
  });

  it("gives the deployed service its digest and never the inert reference, on every call", () => {
    for (const service of ["api", "agent", "web"]) {
      const w = world();
      assert.equal(deploy(w, ["deploy", "staging", service, "1.0.0"]).status, 0);
      const variable = `${service.toUpperCase()}_IMAGE`;
      assert.ok(composeCalls(w).length > 0);
      for (const call of composeCalls(w)) {
        const value = call.match(new RegExp(`${variable}=(\\S+)`))[1];
        assert.equal(value, `${REPO_PREFIX}${service}@sha256:${NEW}`);
      }
    }
  });

  it("deploys web with no migrate step and no provisioning", () => {
    const w = world();
    assert.equal(deploy(w, ["deploy", "staging", "web", "0.1.0"]).status, 0);
    assert.equal(journal(w).find((row) => row.state === "migrated").reason, "no-migrations");
    assert.ok(!calls(w, "docker").some((c) => c.startsWith("exec")));
    assert.equal(composeCalls(w).length, 1);
    assert.ok(composeCalls(w)[0].endsWith("--no-deps web"));
  });

  it("checks the expected digest on production and runs the prod project", () => {
    const w = world({ env: "prod" });
    const result = deploy(w, ["deploy", "prod", "api", "0.3.0"], { stdin: input(NEW) });
    assert.equal(result.status, 0, result.stderr);
    for (const call of composeCalls(w)) {
      assert.match(call, /^JADERO_ENV=prod .*--project-name jadero-prod --profile api /);
      assert.match(call, /compose\.prod\.yml/);
      assert.doesNotMatch(call, /staging/);
    }
  });
});

describe("deploy.sh deploy, failures before provisioned abort and change nothing", () => {
  /** Runs a deploy expected to abort, and checks that nothing shared moved. */
  function expectAborted(w, reason, options) {
    const before = read(join(w.envDir, "versions.env"));
    const envBefore = read(join(w.envDir, "api.env"));
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], options);
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).at(-1), { version: "0.3.0", state: "aborted", reason });
    assert.equal(read(join(w.envDir, "versions.env")), before);
    assert.equal(read(join(w.envDir, "api.env")), envBefore);
    assert.equal(existsSync(join(w.envDir, "api.env.new")), false, "the .new file is removed");
    assert.equal(existsSync(join(w.envDir, "releases/api-0.3.0")), false, "the release is removed");
    assert.ok(existsSync(join(w.envDir, "releases/api-0.2.0")), "the current release stays");
    assert.ok(!calls(w, "docker").some((c) => c.startsWith("exec")), "nothing provisioned");
    assert.deepEqual(composeCalls(w), [], "no container touched");
    return result;
  }

  it("aborts at rendered when op fails (1Password unreachable)", () => {
    const w = apiAt020();
    expectAborted(w, "op-exit-1", { env: { STUB_FAIL: "op" } });
    assert.deepEqual(states(w), ["checked", "fetched", "aborted"]);
    assert.ok(!calls(w, "docker").some((c) => c.startsWith("pull")), "nothing pulled");
  });

  it("aborts when a reference is left unresolved", () => {
    expectAborted(apiAt020(), "unresolved-reference", { env: { STUB_FAIL: "unresolved" } });
  });

  it("aborts, fail closed, when a rendered password is not letters and digits only", () => {
    expectAborted(apiAt020(), "bad-credential", { env: { STUB_PASSWORD: "not-alnum" } });
  });

  it("aborts when the tag cannot be fetched", () => {
    expectAborted(apiAt020(), "fetch-failed", { env: { STUB_FAIL: "fetch" } });
  });

  it("aborts when the image's revision label is not the tag's commit", () => {
    const w = apiAt020();
    expectAborted(w, "revision-mismatch", { env: { STUB_REVISION: "d".repeat(40) } });
    assert.equal(existsSync(read(join(w.rec, "login-config")).trim()), false);
  });

  it("aborts when the pull or the login fails", () => {
    expectAborted(apiAt020(), "pull-failed", { env: { STUB_FAIL: "pull" } });
    expectAborted(apiAt020(), "login-failed", { env: { STUB_FAIL: "login" } });
  });

  it("aborts with the step's own timeout reason when fetch, op, login or pull hangs", () => {
    for (const [word, reason, limit, status] of [
      ["fetch", "fetch-timeout", 30, "124"],
      ["inject", "render-timeout", 30, "124"],
      ["login", "login-timeout", 30, "137"],
      ["pull", "pull-timeout", 180, "124"],
    ]) {
      const w = apiAt020();
      expectAborted(w, reason, { env: { STUB_TIMEOUT: word, STUB_TIMEOUT_STATUS: status } });
      const bounded = calls(w, "timeout").at(-1);
      assert.match(bounded, new RegExp(`^--kill-after=10 ${limit} \\S+ .*\\b${word}\\b`), bounded);
    }
  });

  it("runs every remote step under its limit, and nothing else", () => {
    const w = apiAt020();
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    const bounded = calls(w, "timeout").map((call) => call.split(" ").slice(1, 3).join(" "));
    assert.deepEqual(bounded, ["30 git", "30 op", "30 docker", "180 docker", "120 env"]);
    assert.ok(calls(w, "timeout")[4].includes(" run --rm --no-deps -T api-migrate"));
  });

  it("refuses prod without an expected digest, and aborts on a different one", () => {
    const w = world({ env: "prod" });
    const result = deploy(w, ["deploy", "prod", "api", "0.3.0"]);
    assert.equal(result.status, 1);
    assert.deepEqual(states(w), ["refused"]);
    assert.equal(journal(w)[0].reason, "no-digest");
    const v = world({ env: "prod" });
    assert.equal(deploy(v, ["deploy", "prod", "api", "0.3.0"], { stdin: input(OLD) }).status, 1);
    assert.equal(journal(v).at(-1).reason, "digest-mismatch");
  });
});

describe("deploy.sh deploy, failures from provisioned on roll back", () => {
  it("rolls back to the previous digest and release files when the new version is unhealthy", () => {
    const w = apiAt020();
    const before = read(join(w.envDir, "versions.env"));
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], { env: { STUB_FAIL: "up" } });
    assert.equal(result.status, 1);
    assert.deepEqual(states(w), [...STATES.slice(0, 6), "rolling_back", "rolled_back"]);
    assert.equal(journal(w).at(-2).reason, "unhealthy");
    assert.equal(
      read(join(w.envDir, "versions.env")),
      `${before}MESSAGING_VERSION=${MESSAGING}\n`,
      "a failed deploy never becomes current; only the topology record moved forward",
    );
    const ups = composeCalls(w).filter((c) => c.includes(" up "));
    assert.equal(ups.length, 2);
    assert.match(ups[1], new RegExp(`API_IMAGE=${REPO_PREFIX}api@sha256:${OLD} `));
    assert.match(ups[1], new RegExp(`-f ${w.envDir}/releases/api-0.2.0/infra/compose/`));
    // The newest env file, rendered in this run: the passwords just provisioned match it.
    assert.match(read(join(w.envDir, "api.env")), new RegExp(SECRET));
  });

  it("ends failed, with no retry loop, when the previous version is unhealthy too", () => {
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FAIL: "up-all" },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).slice(-2), [
      { version: "0.3.0", state: "rolling_back", reason: "unhealthy" },
      { version: "0.3.0", state: "failed", reason: "previous-unhealthy" },
    ]);
    assert.equal(composeCalls(w).filter((c) => c.includes(" up ")).length, 2);
  });

  it("rolls back when the migrate step or the smoke fails", () => {
    for (const [fail, reason] of [
      ["migrate", "migrate-failed"],
      ["smoke", "smoke-failed"],
      ["psql", "provision-failed"],
    ]) {
      const w = apiAt020();
      assert.equal(
        deploy(w, ["deploy", "staging", "api", "0.3.0"], { env: { STUB_FAIL: fail } }).status,
        1,
      );
      assert.deepEqual(
        journal(w)
          .slice(-2)
          .map((row) => [row.state, row.reason]),
        [
          ["rolling_back", reason],
          ["rolled_back", "previous-healthy"],
        ],
      );
    }
  });

  it("rolls back on a migrate timeout and removes the migrate container it may leave", () => {
    // 124: TERM ended the migration at the limit; 137: the KILL 10 s later was needed.
    for (const status of ["124", "137"]) {
      const w = apiAt020();
      const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
        env: { STUB_TIMEOUT: "run", STUB_TIMEOUT_STATUS: status },
      });
      assert.equal(result.status, 1);
      assert.deepEqual(
        journal(w)
          .slice(-2)
          .map((row) => [row.state, row.reason]),
        [
          ["rolling_back", "migrate-timeout"],
          ["rolled_back", "previous-healthy"],
        ],
        status,
      );
      assert.ok(calls(w, "docker").includes(MIGRATE_RUNS_LOOKUP), status);
      // The previous release starts again, with no time limit of ours (up --wait has its own).
      assert.equal(composeCalls(w).filter((c) => c.includes(" up ")).length, 1);
    }
  });

  it("reads a 137 before the migrate limit as the migration's own failure, not a timeout", () => {
    // `docker compose run` returns 137 when the kernel OOM-kills the container under its
    // mem_limit: the limit has not passed, so the reason is the step's normal failure.
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_EXIT: "run", STUB_EXIT_STATUS: "137" },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(
      journal(w)
        .slice(-2)
        .map((row) => [row.state, row.reason]),
      [
        ["rolling_back", "migrate-failed"],
        ["rolled_back", "previous-healthy"],
      ],
    );
    assert.ok(!calls(w, "docker").includes(MIGRATE_RUNS_LOOKUP));
  });

  it("rolls back with this run's env when a provisioning write already happened", () => {
    // Postgres converged (a role password may be new), then the broker step failed: the previous
    // release must start with the env that matches Postgres, so Compose recreates its containers.
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FAIL: "broker" },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).slice(-2), [
      { version: "0.3.0", state: "rolling_back", reason: "provision-failed" },
      { version: "0.3.0", state: "rolled_back", reason: "previous-healthy" },
    ]);
    assert.ok(
      calls(w, "docker").some((c) => c.includes("psql")),
      "Postgres was provisioned",
    );
    const envFile = join(w.envDir, "api.env");
    assert.match(read(envFile), new RegExp(`content_\\$\\{JADERO_ENV\\}:${SECRET}@`));
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    assert.equal(existsSync(join(w.envDir, "api.env.new")), false);
    // No migrate, no new containers: the one up is the previous release on the new env.
    const files = `-f ${w.envDir}/releases/api-0.2.0/infra/compose/compose.services.yml -f ${w.envDir}/releases/api-0.2.0/infra/compose/compose.staging.yml`;
    assert.deepEqual(composeCalls(w), [
      `JADERO_ENV=staging API_IMAGE=${REPO_PREFIX}api@sha256:${OLD} AGENT_IMAGE=${INERT} WEB_IMAGE=${INERT} COMPOSE_PROJECT_NAME= :: compose --project-name jadero-staging --profile api ${files} up -d --wait --wait-timeout 120 --no-deps api api-worker`,
    ]);
  });

  it("keeps this run's env on a redeploy whose provisioning fails half way", () => {
    const w = apiAt020();
    const result = deploy(w, ["redeploy", "staging", "api"], { env: { STUB_FAIL: "psql" } });
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).slice(-2), [
      { version: "0.2.0", state: "rolling_back", reason: "provision-failed" },
      { version: "0.2.0", state: "rolled_back", reason: "previous-healthy" },
    ]);
    assert.match(read(join(w.envDir, "api.env")), new RegExp(SECRET));
    assert.equal(existsSync(join(w.envDir, "api.env.new")), false);
  });

  it("keeps the old env and removes the .new file when the topology fails before any role", () => {
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FAIL: "import" },
    });
    assert.equal(result.status, 1);
    assert.equal(journal(w).at(-2).reason, "topology-failed");
    assert.ok(!calls(w, "docker").some((c) => c.includes("psql")), "no role touched");
    assert.equal(read(join(w.envDir, "api.env")), "OLD=1\n", "the passwords did not move");
    assert.equal(existsSync(join(w.envDir, "api.env.new")), false, "no rendered secrets left");
  });

  it("ends failed when there is nothing to roll back to, the new containers stopped", () => {
    const w = world();
    assert.equal(
      deploy(w, ["deploy", "staging", "api", "0.1.0"], { env: { STUB_FAIL: "up" } }).status,
      1,
    );
    assert.deepEqual(journal(w).at(-1), {
      version: "0.1.0",
      state: "failed",
      reason: "nothing-to-roll-back-to",
    });
    // A first deploy runs whole or not at all: stopped, not removed, so the logs stay readable.
    const last = composeCalls(w).at(-1);
    assert.match(last, new RegExp(`API_IMAGE=${REPO_PREFIX}api@sha256:${NEW} `));
    assert.match(last, / stop api api-worker$/);
    assert.ok(!composeCalls(w).some((c) => / (rm|down)\b/.test(c)), "nothing removed");
  });

  it("stops a first deploy's containers when its smoke fails, and only once they exist", () => {
    const smoke = world();
    assert.equal(
      deploy(smoke, ["deploy", "staging", "agent", "0.1.0"], { env: { STUB_FAIL: "smoke" } })
        .status,
      1,
    );
    assert.deepEqual(journal(smoke).slice(-2), [
      { version: "0.1.0", state: "rolling_back", reason: "smoke-failed" },
      { version: "0.1.0", state: "failed", reason: "nothing-to-roll-back-to" },
    ]);
    assert.match(composeCalls(smoke).at(-1), / stop agent agent-consumer$/);
    // A failed migrate created no container (run --rm): nothing to stop.
    const migrate = world();
    deploy(migrate, ["deploy", "staging", "api", "0.1.0"], { env: { STUB_FAIL: "migrate" } });
    assert.equal(journal(migrate).at(-1).reason, "nothing-to-roll-back-to");
    assert.ok(!composeCalls(migrate).some((c) => / stop /.test(c)));
  });

  it("says so when a first deploy's containers cannot be stopped", () => {
    const w = world();
    deploy(w, ["deploy", "staging", "api", "0.1.0"], { env: { STUB_FAIL: "up stop" } });
    assert.deepEqual(journal(w).at(-1), {
      version: "0.1.0",
      state: "failed",
      reason: "stop-failed",
    });
  });
});

describe("deploy.sh, the topology of the release (ADR-053)", () => {
  const provisionedReason = (w) => journal(w).find((row) => row.state === "provisioned").reason;
  const imports = (w) => calls(w, "docker").filter((c) => c.includes("import_definitions"));
  const recordedMessaging = (w) =>
    lines(join(w.envDir, "versions.env")).filter((line) => line.startsWith("MESSAGING_VERSION="));

  it("imports its environment's definitions on stdin, before the roles, and records the version", () => {
    for (const env of ["staging", "prod"]) {
      const w = world({ env });
      const stdin = env === "prod" ? input(NEW) : input();
      assert.equal(deploy(w, ["deploy", env, "agent", "0.3.0"], { stdin }).status, 0);
      assert.deepEqual(imports(w), [
        "exec -i jadero-ops-rabbitmq-1 rabbitmqctl import_definitions",
      ]);
      assert.equal(
        read(join(w.rec, "rabbit-import")),
        read(join(fixture, `infra/rabbitmq/server/definitions/${env}.json`)),
      );
      // Waited for the queues, then provisioned the roles and the user.
      const docker = calls(w, "docker");
      const imported = docker.findIndex((c) => c.includes("import_definitions"));
      assert.ok(docker.findIndex((c) => c.includes(`list_queues -p /${env}`)) > imported);
      assert.ok(docker.findIndex((c) => c.includes("psql")) > imported);
      assert.equal(provisionedReason(w), "topology-imported");
      assert.deepEqual(recordedMessaging(w), [`MESSAGING_VERSION=${MESSAGING}`]);
      assert.deepEqual(states(w), STATES);
    }
  });

  it("skips an older messaging version (0.9.0 after 0.10.0) and deploys on", () => {
    const w = apiAt020({
      versions: {
        API_VERSION: "0.2.0",
        API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}`,
        MESSAGING_VERSION: "0.10.0",
      },
    });
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FIXTURE: fixtureWith("0.9.0") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(imports(w), [], "an older file would overwrite newer policies");
    assert.equal(provisionedReason(w), "topology-skipped-older");
    assert.deepEqual(recordedMessaging(w), ["MESSAGING_VERSION=0.10.0"]);
    assert.deepEqual(states(w), STATES);
  });

  it("imports an equal version again and leaves the record as it was", () => {
    const w = apiAt020({
      versions: {
        API_VERSION: "0.2.0",
        API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}`,
        MESSAGING_VERSION: MESSAGING,
      },
    });
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    assert.equal(imports(w).length, 1);
    assert.equal(provisionedReason(w), "topology-imported");
    assert.deepEqual(recordedMessaging(w), [`MESSAGING_VERSION=${MESSAGING}`]);
  });

  it("records a newer version before the import, so a rollback after it keeps the record", () => {
    const w = apiAt020({
      versions: {
        API_VERSION: "0.2.0",
        API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}`,
        MESSAGING_VERSION: "0.1.0",
      },
    });
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FAIL: "import" },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).slice(-2), [
      { version: "0.3.0", state: "rolling_back", reason: "topology-failed" },
      { version: "0.3.0", state: "rolled_back", reason: "previous-healthy" },
    ]);
    // The broker may hold the new definitions: shared state moves forward only.
    assert.deepEqual(recordedMessaging(w), [`MESSAGING_VERSION=${MESSAGING}`]);
    assert.match(read(join(w.envDir, "versions.env")), /^API_VERSION=0\.2\.0$/m);
    assert.ok(!calls(w, "docker").some((c) => c.includes("psql")), "no role touched");
  });

  it("keeps the record through a rollback, and previous.env never carries it", () => {
    const w = world({
      versions: {
        API_VERSION: "0.3.0",
        API_IMAGE: `${REPO_PREFIX}api@sha256:${NEW}`,
        MESSAGING_VERSION: "0.3.0",
      },
      previous: { API_VERSION: "0.2.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}` },
      releases: ["api-0.2.0", "api-0.3.0"],
      envFiles: ["api"],
    });
    assert.equal(deploy(w, ["rollback", "staging", "api"], { stdin: "" }).status, 0);
    assert.deepEqual(recordedMessaging(w), ["MESSAGING_VERSION=0.3.0"]);
    assert.doesNotMatch(read(join(w.envDir, "previous.env")), /MESSAGING/);
    assert.deepEqual(imports(w), [], "a rollback imports nothing");
  });

  it("imports nothing for web", () => {
    const w = world();
    assert.equal(deploy(w, ["deploy", "staging", "web", "0.1.0"]).status, 0);
    assert.deepEqual(imports(w), []);
    assert.equal(provisionedReason(w), "this-service");
    assert.deepEqual(recordedMessaging(w), []);
  });

  it("aborts before anything shared moves when the release has no usable messaging version", () => {
    // No package file at the tag: git archive fails on the missing path. A version that is not
    // semver: the guard could not compare it.
    for (const [messaging, reason] of [
      [null, "fetch-failed"],
      ["next", "no-topology-files"],
    ]) {
      const w = apiAt020();
      const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
        env: { STUB_FIXTURE: fixtureWith(messaging) },
      });
      assert.equal(result.status, 1);
      assert.deepEqual(journal(w).at(-1), { version: "0.3.0", state: "aborted", reason });
      assert.deepEqual(states(w), ["checked", "aborted"]);
      assert.ok(!calls(w, "docker").some((c) => c.startsWith("exec")));
      assert.equal(existsSync(join(w.envDir, "releases/api-0.3.0")), false);
    }
  });

  it("refuses a manifest whose recorded messaging version is not semver", () => {
    const w = apiAt020({
      versions: {
        API_VERSION: "0.2.0",
        API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}`,
        MESSAGING_VERSION: "latest",
      },
    });
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 1);
    assert.deepEqual(states(w), ["refused"]);
    assert.equal(journal(w)[0].reason, "bad-manifest");
  });
});

describe("deploy.sh, the smoke checks (D7)", () => {
  it("opens the ping window when up --wait returned healthy, never before", () => {
    const w = apiAt020();
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    const since = Number(calls(w, "smoke")[0].split(" ")[2]);
    const upReturned = Number(read(join(w.rec, "up-returned")).trim());
    assert.ok(since >= upReturned, `${since} is not before ${upReturned}`);
  });

  it("passes the services deployed in the environment, this one first", () => {
    const w = world({
      versions: {
        AGENT_VERSION: "0.2.0",
        AGENT_IMAGE: `${REPO_PREFIX}agent@sha256:${OLD}`,
        WEB_VERSION: "0.1.0",
        WEB_IMAGE: `${REPO_PREFIX}web@sha256:${OLD}`,
      },
    });
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    assert.match(calls(w, "smoke")[0], /^staging api \d+ api,agent,web$/);
  });

  it("journals the skipped checks as fixed tokens, and ignores any other output", () => {
    const w = world();
    const result = deploy(w, ["deploy", "staging", "agent", "0.1.0"], {
      env: { STUB_SKIPPED: "ping evil;id pages" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      journal(w).find((row) => row.state === "verified"),
      {
        version: "0.1.0",
        state: "verified",
        reason: "smoke-passed-partial-ping-pages",
      },
    );
    assert.equal(journal(w).at(-1).state, "recorded");
  });

  it("says smoke-passed when nothing was skipped, on a deploy and on a rollback", () => {
    const w = world({
      versions: { API_VERSION: "0.3.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${NEW}` },
      previous: { API_VERSION: "0.2.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}` },
      releases: ["api-0.2.0", "api-0.3.0"],
      envFiles: ["api"],
    });
    assert.equal(deploy(w, ["rollback", "staging", "api"], { stdin: "" }).status, 0);
    assert.equal(journal(w).find((row) => row.state === "verified").reason, "smoke-passed");
    assert.match(calls(w, "smoke")[0], /^staging api \d+ api$/);
  });
});

describe("deploy.sh, the anti-rollback guard (semver precedence)", () => {
  const cases = [
    ["0.9.0", "0.10.0", true],
    ["0.2.0", "0.2.1", true],
    ["0.2.0", "1.0.0", true],
    ["1.0.0-rc.1", "1.0.0", true],
    ["1.0.0-rc.1", "1.0.0-rc.2", true],
    ["1.0.0-rc.9", "1.0.0-rc.10", true],
    ["1.0.0-alpha", "1.0.0-alpha.1", true],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", true],
    ["1.0.0", "1.0.0-rc.1", false],
    ["1.0.0-rc.10", "1.0.0-rc.9", false],
    ["0.10.0", "0.9.0", false],
    ["0.2.0", "0.2.0", false],
    ["0.2.0", "0.1.9", false],
    ["99999999999999999999.0.0", "100000000000000000000.0.0", true],
  ];
  for (const [current, candidate, accepted] of cases) {
    it(`${accepted ? "accepts" : "refuses"} ${candidate} over ${current}`, () => {
      const w = world({
        versions: { API_VERSION: current, API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}` },
      });
      // A failing fetch stops an accepted run right after `checked`.
      const result = deploy(w, ["deploy", "staging", "api", candidate], {
        env: { STUB_FAIL: "fetch" },
      });
      assert.equal(result.status, 1);
      if (accepted) {
        assert.deepEqual(states(w), ["checked", "aborted"]);
      } else {
        assert.deepEqual(journal(w), [
          { version: candidate, state: "refused", reason: "not-newer" },
        ]);
        assert.deepEqual(calls(w, "git"), [], "nothing fetched");
      }
    });
  }
});

describe("deploy.sh rollback and redeploy", () => {
  const at030 = () =>
    world({
      versions: { API_VERSION: "0.3.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${NEW}` },
      previous: { API_VERSION: "0.2.0", API_IMAGE: `${REPO_PREFIX}api@sha256:${OLD}` },
      releases: ["api-0.2.0", "api-0.3.0"],
      envFiles: ["api"],
    });

  it("returns once to previous.env with nothing remote, and a second rollback refuses", () => {
    const w = at030();
    const result = deploy(w, ["rollback", "staging", "api"], { stdin: "" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      journal(w).map((row) => [row.version, row.state]),
      [
        ["0.2.0", "checked"],
        ["0.2.0", "started"],
        ["0.2.0", "verified"],
        ["0.2.0", "recorded"],
      ],
    );
    assert.equal(
      read(join(w.envDir, "versions.env")),
      `API_VERSION=0.2.0\nAPI_IMAGE=${REPO_PREFIX}api@sha256:${OLD}\n`,
    );
    assert.equal(read(join(w.envDir, "previous.env")), "");
    const [up] = composeCalls(w);
    assert.match(up, new RegExp(`API_IMAGE=${REPO_PREFIX}api@sha256:${OLD} `));
    assert.match(up, /releases\/api-0\.2\.0\/infra\/compose\/compose\.services\.yml/);
    assert.deepEqual(calls(w, "op"), []);
    assert.deepEqual(calls(w, "git"), []);
    assert.ok(!calls(w, "docker").some((c) => /^(login|pull)/.test(c)));

    const again = deploy(w, ["rollback", "staging", "api"], { stdin: "" });
    assert.equal(again.status, 1);
    assert.deepEqual(journal(w).at(-1), { version: "-", state: "refused", reason: "no-previous" });
  });

  it("ends failed when the previous version is unhealthy, and keeps the manifests", () => {
    const w = at030();
    const before = read(join(w.envDir, "versions.env"));
    const result = deploy(w, ["rollback", "staging", "api"], { env: { STUB_FAIL: "up-all" } });
    assert.equal(result.status, 1);
    assert.deepEqual(states(w), ["checked", "failed"]);
    assert.equal(read(join(w.envDir, "versions.env")), before);
  });

  it("refuses redeploy for the deploy user, before touching anything", () => {
    const w = at030();
    const result = deploy(w, ["redeploy", "staging", "api"], { env: { SUDO_USER: "deploy" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owner's root shell only/);
    assert.equal(existsSync(join(w.envDir, "deploy.log")), false);
    assert.deepEqual(calls(w, "op"), []);
  });

  it("redeploys the current version with fresh secrets from the owner's shell", () => {
    const w = at030();
    const before = read(join(w.envDir, "versions.env"));
    const result = deploy(w, ["redeploy", "staging", "api"], { stdin: "" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(states(w), STATES);
    assert.ok(journal(w).every((row) => row.version === "0.3.0"));
    // The same release again: its topology is imported again, nothing else in the manifest moves.
    assert.equal(read(join(w.envDir, "versions.env")), `${before}MESSAGING_VERSION=${MESSAGING}\n`);
    assert.ok(existsSync(join(w.rec, "rabbit-import")));
    assert.deepEqual(calls(w, "git"), []);
    assert.ok(!calls(w, "docker").some((c) => /^(login|pull)/.test(c)));
    assert.match(read(join(w.envDir, "api.env")), new RegExp(SECRET));
  });

  it("finishes a redeploy from an interactive terminal, compose kept off it", () => {
    const w = at030();
    // python3's pty.spawn gives deploy.sh a real pseudo-terminal on stdin as its controlling
    // terminal, as the owner's sudo shell does (the same call on macOS and Linux). Before the
    // fix the migrate run's stty stopped its process group and this hung until the timeout.
    const ptyRun =
      "import os, pty, sys\nsys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))";
    let result;
    try {
      result = spawnSync("python3", ["-I", "-c", ptyRun, w.script, "redeploy", "staging", "api"], {
        env: stubEnv(w),
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 20_000,
      });
    } finally {
      // A stopped group ignores the hangup deploy.sh ignores; kill it so no test leaves it.
      const pgid = Number(read(join(w.rec, "run-pgid")).trim());
      if (pgid > 1) spawnSync("kill", ["-KILL", `-${pgid}`]);
    }
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(states(w), STATES);
    assert.equal(read(join(w.rec, "op-stdin")), "tty\n", "deploy.sh ran with a terminal on stdin");
    assert.deepEqual(lines(join(w.rec, "run-stdin")), ["no-tty"]);
    assert.ok(composeCalls(w)[0].endsWith(" run --rm --no-deps -T api-migrate"));
  });
});

describe("deploy.sh, mutual exclusion and lost sessions", () => {
  it("exits 75 without touching anything while another run holds the lock", async () => {
    const w = apiAt020();
    const lockFile = join(w.envDir, "deploy.lock");
    const holder = spawn("perl", [
      "-e",
      'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "held\\n"; sleep 30',
      lockFile,
    ]);
    try {
      await new Promise((resolve) => holder.stdout.once("data", resolve));
      const before = read(join(w.envDir, "versions.env"));
      const result = deploy(w, ["deploy", "staging", "api", "0.3.0"]);
      assert.equal(result.status, 75);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(join(w.envDir, "deploy.log")), false);
      assert.equal(read(join(w.envDir, "versions.env")), before);
      for (const tool of ["docker", "op", "git"]) assert.deepEqual(calls(w, tool), []);
    } finally {
      holder.kill();
    }
    // Released with its holder: the next run goes through.
    assert.equal(deploy(w, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    // The lock is in the state folder (root-owned on the server); one deploy creates it 600.
    const fresh = apiAt020();
    assert.equal(deploy(fresh, ["deploy", "staging", "api", "0.3.0"]).status, 0);
    assert.equal(statSync(join(fresh.envDir, "deploy.lock")).mode & 0o777, 0o600);
  });

  it("leaves no lock behind when a step's child outlives the deploy", () => {
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_OP_DAEMON: "1" },
    });
    const daemon = Number(read(join(w.rec, "op-daemon")).trim());
    try {
      assert.equal(result.status, 0);
      // The daemon still runs, and the lock is free: the next deploy would not exit 75.
      assert.doesNotThrow(() => process.kill(daemon, 0));
      const probe = spawnSync("perl", [
        "-e",
        'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or exit 2; flock($f, LOCK_EX | LOCK_NB) or exit 1; exit 0',
        join(w.envDir, "deploy.lock"),
      ]);
      assert.equal(probe.status, 0);
    } finally {
      try {
        process.kill(daemon);
      } catch {
        // Already gone: nothing to clean up.
      }
    }
  });

  it("ignores SIGHUP and a closed stdout, and runs on to recorded", async () => {
    const w = apiAt020();
    const child = spawn(w.script, ["deploy", "staging", "api", "0.3.0"], {
      env: stubEnv(w, { STUB_SLOW_UP: "1" }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(input());
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    const marker = join(w.rec, "up-started");
    for (let i = 0; i < 200 && !existsSync(marker); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(existsSync(marker), "the deploy reached up");
    // What sshd does when the runner disappears: the session's pipes close, then SIGHUP.
    child.stdout.destroy();
    child.kill("SIGHUP");
    assert.equal(await exited, 0);
    assert.deepEqual(states(w), STATES);
  });
});

describe("deploy.sh, one environment value", () => {
  it("aborts at fetched when the release's overlay names another project", () => {
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { STUB_FIXTURE: mismatchFixture },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(journal(w).at(-1), {
      version: "0.3.0",
      state: "aborted",
      reason: "env-mismatch",
    });
    assert.deepEqual(composeCalls(w), []);
    assert.deepEqual(calls(w, "op"), []);
  });

  it("derives JADERO_ENV, the overlay and the project from the env word, never the caller", () => {
    const w = apiAt020();
    const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
      env: { JADERO_ENV: "prod", COMPOSE_PROJECT_NAME: "jadero-prod", COMPOSE_FILE: "/x.yml" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read(join(w.rec, "op-env")).split(" ")[0], "JADERO_ENV=staging");
    for (const call of composeCalls(w)) {
      assert.match(
        call,
        /^JADERO_ENV=staging .* COMPOSE_PROJECT_NAME= :: compose --project-name jadero-staging /,
      );
      assert.match(call, /compose\.staging\.yml/);
      assert.doesNotMatch(call, /prod/);
    }
  });

  it("builds every overlay path, project name and JADERO_ENV from one variable", () => {
    const source = readFileSync(DEPLOY_SH, "utf8");
    assert.match(source, /env JADERO_ENV="\$ENV_NAME"/);
    assert.match(source, /--project-name "jadero-\$ENV_NAME"/);
    assert.match(source, /compose\.\$ENV_NAME\.yml/);
    assert.doesNotMatch(source, /compose\.(staging|prod)\.yml/, "no overlay is named by hand");
    assert.doesNotMatch(source, /jadero-(staging|prod)\b/, "no project is named by hand");
  });
});

describe("deploy.sh, what reaches the journal and stdout", () => {
  it("never shows a rendered secret, the token or docker compose output (config prints secrets)", () => {
    for (const fail of ["", "up", "up-all"]) {
      const w = apiAt020();
      const result = deploy(w, ["deploy", "staging", "api", "0.3.0"], {
        env: { STUB_FAIL: fail },
      });
      const shown = `${result.stdout}${result.stderr}${read(join(w.envDir, "deploy.log"))}`;
      assert.ok(composeCalls(w).length > 0, "compose ran and printed the canary");
      for (const secret of [COMPOSE_CANARY, SECRET, OP_TOKEN, "fake-registry-token-123"]) {
        assert.ok(!shown.includes(secret), `${secret} stays out of what the run shows`);
      }
    }
  });

  it("never puts a password in an argument list (env NAME=value would show it in ps)", () => {
    const code = readFileSync(DEPLOY_SH, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    assert.deepEqual(
      code.filter(
        (line) =>
          /\benv\b.*(PASSWORD|TOKEN)[A-Z_]*=|"\$variable=/.test(line) && !/export/.test(line),
      ),
      [],
    );
  });

  it("never runs docker compose config itself, and discards every tool's output", () => {
    const code = readFileSync(DEPLOY_SH, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    assert.ok(
      !code.some((line) => /compose_in .*\bconfig\b|docker compose .*\bconfig\b/.test(line)),
    );
    // compose_in builds the command once and runs it with or without its time limit: both runs
    // discard the output.
    assert.ok(code.some((line) => line.includes("command=(env JADERO_ENV=")));
    const runs = code.filter((line) => line.includes(`"\${command[@]}"`));
    assert.equal(runs.length, 2);
    for (const line of runs) assert.match(line, />\/dev\/null 2>&1$/);
  });
});

describe("deploy.sh, refused words", () => {
  const bad = [
    ["no arguments", []],
    ["the WP-8 form without a verb", ["staging", "api", "0.4.1"]],
    ["deploy without a version", ["deploy", "staging", "api"]],
    ["deploy with an extra word", ["deploy", "staging", "api", "0.4.1", "extra"]],
    ["rollback with a version", ["rollback", "staging", "api", "0.4.1"]],
    ["an unknown verb", ["remove", "staging", "api"]],
    ["bad env", ["deploy", "dev", "api", "0.4.1"]],
    ["unknown service", ["deploy", "staging", "contact", "0.4.1"]],
    ["two services in one argument", ["deploy", "staging", "api agent", "0.4.1"]],
    ["empty service", ["deploy", "staging", "", "0.4.1"]],
    ["leading v", ["deploy", "staging", "api", "v0.4.1"]],
    ["shell text in the version", ["deploy", "staging", "api", "0.4.1;id"]],
    ["newline in the version", ["deploy", "staging", "api", "0.4.1\nid"]],
  ];
  for (const [name, args] of bad) {
    it(`refuses ${name} before taking the lock or writing anything`, () => {
      const w = world();
      const result = deploy(w, args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^refused: expected "deploy\.sh deploy <env> <service> <version>"/,
      );
      assert.equal(existsSync(join(w.envDir, "deploy.log")), false);
      assert.equal(existsSync(join(w.envDir, "deploy.lock")), false);
    });
  }
});
