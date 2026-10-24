// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
//
// Tests the deploy user's forced command (`infra/scripts/deploy-entry`), WP-8 D3 and WP-9 D2: each
// key line binds it to one environment, and it accepts `deploy <env> <service> <version>` and
// `rollback <env> <service>` for that environment only. The production script reads no path from
// the environment, so each test run copies deploy-entry into a temporary folder and rewrites its
// three path constants to fakes: a sudo that records its arguments and runs a fake deploy.sh, which
// records its own arguments and standard input, and a logger that appends to a file. The rewrite
// fails loudly if a constant is renamed, so a test can never reach the real sudo. deploy.sh itself
// is tested in deploy.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../infra/scripts/", import.meta.url));
const ENTRY = join(SCRIPTS, "deploy-entry");
const DEPLOY_SH = join(SCRIPTS, "deploy.sh");
const USAGE = 'refused: expected "deploy <env> <service> <version>" or "rollback <env> <service>"';

let dir;
let entry;
let fakeDeploySh;
let sudoCalls;
let deployCalls;
let deployInput;
let logFile;

/**
 * Replaces one `readonly NAME=...` line of the script, and fails when the line is missing, so a
 * renamed constant cannot leave a production path in the copy under test.
 * @param {string} source the script text
 * @param {string} name the constant name
 * @param {string} value the new value
 * @returns {string} the rewritten script
 */
function rewriteConstant(source, name, value) {
  const line = new RegExp(`^readonly ${name}=.*$`, "m");
  assert.match(source, line, `deploy-entry declares ${name}`);
  return source.replace(line, `readonly ${name}='${value}'`);
}

/**
 * Writes an executable bash script into the test folder.
 * @param {string} name the file name
 * @param {string} body the script body after the shebang
 * @returns {string} the absolute path
 */
function writeScript(name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * Runs the rewritten deploy-entry as sshd would: the key line's arguments, the client's words in
 * SSH_ORIGINAL_COMMAND and the client's standard input.
 * @param {string | undefined} command the client's command, or undefined to leave it unset
 * @param {{ binding?: string[], clientEnv?: Record<string, string>, input?: string }} [options]
 *   the key line's arguments (default `staging`), the variables the client sends (sshd's
 *   AcceptEnv) and the client's standard input
 * @returns {{ status: number | null, stdout: string, stderr: string }} the result
 */
function runEntry(command, { binding = ["staging"], clientEnv = {}, input = "" } = {}) {
  for (const file of [sudoCalls, deployCalls, deployInput, logFile]) rmSync(file, { force: true });
  const env = { PATH: process.env.PATH, ...clientEnv };
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command;
  const result = spawnSync(entry, binding, { env, input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs the real deploy.sh directly with the given arguments: only its word checks, which refuse
 * before it takes a lock or reads a file.
 * @param {string[]} args the arguments
 * @param {Record<string, string>} callerEnv variables the caller passes through sudo
 * @returns {{ status: number | null, stdout: string, stderr: string }} the result
 */
function runDeploySh(args, callerEnv = {}) {
  const env = { PATH: process.env.PATH, ...callerEnv };
  const result = spawnSync(DEPLOY_SH, args, { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const readIfExists = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

before(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-entry-"));
  sudoCalls = join(dir, "sudo-calls");
  deployCalls = join(dir, "deploy-calls");
  deployInput = join(dir, "deploy-input");
  logFile = join(dir, "log");
  fakeDeploySh = writeScript(
    "fake-deploy.sh",
    `printf '%s\\n' "$*" >> '${deployCalls}'\ncat > '${deployInput}'`,
  );
  const sudo = writeScript(
    "fake-sudo",
    `printf '%s\\n' "$*" >> '${sudoCalls}'\n[ "$1" = "-n" ] && shift\nexec "$@"`,
  );
  const logger = writeScript("fake-logger", `printf '%s\\n' "$*" >> '${logFile}'`);
  let source = readFileSync(ENTRY, "utf8");
  source = rewriteConstant(source, "DEPLOY_SH", fakeDeploySh);
  source = rewriteConstant(source, "SUDO", sudo);
  source = rewriteConstant(source, "LOGGER", logger);
  entry = writeScript("deploy-entry", source.replace(/^#!.*\n/, ""));
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("deploy-entry, accepted commands", () => {
  const cases = [
    ["staging", "deploy staging api 0.4.1", "deploy staging api 0.4.1", "version=0.4.1"],
    ["prod", "deploy prod agent 1.12.0", "deploy prod agent 1.12.0", "version=1.12.0"],
    ["prod", "deploy prod web 2.0.0-rc.1", "deploy prod web 2.0.0-rc.1", "version=2.0.0-rc.1"],
    ["staging", "  deploy   staging  api  0.4.1  ", "deploy staging api 0.4.1", "version=0.4.1"],
    ["staging", "rollback staging api", "rollback staging api", ""],
    ["prod", "rollback prod web", "rollback prod web", ""],
  ];
  for (const [binding, command, args, version] of cases) {
    it(`runs deploy.sh through sudo -n for "${command}" on the ${binding} key`, () => {
      const result = runEntry(command, { binding: [binding] });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readIfExists(sudoCalls), `-n ${fakeDeploySh} ${args}\n`);
      assert.equal(readIfExists(deployCalls), `${args}\n`);
      const [verb, env, service] = args.split(" ");
      const logged = `verb=${verb} env=${env} service=${service}${version ? ` ${version}` : ""}`;
      assert.equal(readIfExists(logFile), `-t jadero-deploy -- accepted ${logged}\n`);
    });
  }

  it("passes the client's standard input through to deploy.sh untouched, and never logs it", () => {
    const input = `octocat\nghs_notARealToken123\nsha256:${"a".repeat(64)}\n`;
    const result = runEntry("deploy staging api 0.4.1", { input });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readIfExists(deployInput), input);
    assert.doesNotMatch(readIfExists(logFile), /octocat|ghs_|sha256/);
  });
});

describe("deploy-entry, refused commands", () => {
  const cases = [
    ["unset", undefined, "empty"],
    ["empty", "", "empty"],
    ["only spaces", "   ", "word-count"],
    ["a shell", "bash", "word-count"],
    ["bad env", "deploy dev api 0.4.1", "bad-env"],
    ["env in capitals", "deploy STAGING api 0.4.1", "bad-env"],
    ["the other environment", "deploy prod api 0.4.1", "env-mismatch"],
    ["a rollback on the other environment", "rollback prod api", "env-mismatch"],
    ["unknown service", "deploy staging contact 0.4.1", "bad-service"],
    ["service not yet released", "deploy staging mcp 0.4.1", "bad-service"],
    ["leading v", "deploy staging api v1.2.3", "bad-version"],
    ["two parts", "deploy staging api 1.2", "bad-version"],
    ["leading zero", "deploy staging api 01.2.3", "bad-version"],
    ["empty pre-release identifier", "deploy staging api 1.2.3-rc..1", "bad-version"],
    ["build metadata", "deploy staging api 1.2.3+build", "bad-characters"],
    ["semicolon in version", "deploy staging api 1.2.3;id", "bad-characters"],
    ["extra word", "deploy staging api 0.4.1 now", "word-count"],
    ["missing word", "deploy staging api", "word-count"],
    ["a rollback with a version", "rollback staging api 0.4.1", "word-count"],
    ["redeploy, the owner's verb", "redeploy staging api", "bad-verb"],
    ["wrong verb", "remove staging api 0.4.1", "bad-verb"],
    ["semicolon", "deploy staging api 0.4.1; id", "bad-characters"],
    ["command substitution", "deploy staging api $(id)", "bad-characters"],
    ["backticks", "deploy staging api `id`", "bad-characters"],
    ["single quotes", "deploy staging 'api' 0.4.1", "bad-characters"],
    ["double quotes", 'deploy staging "api" 0.4.1', "bad-characters"],
    ["newline", "deploy staging api 0.4.1\nid", "bad-characters"],
    ["tab", "deploy\tstaging api 0.4.1", "bad-characters"],
    ["pipe", "deploy staging api 0.4.1 | id", "bad-characters"],
    ["ampersand", "deploy staging api 0.4.1 && id", "bad-characters"],
    ["glob", "deploy staging * 0.4.1", "bad-characters"],
    ["path", "deploy staging ../api 0.4.1", "bad-characters"],
    ["too long", `deploy staging api 1.2.3-${"a".repeat(200)}`, "too-long"],
  ];
  for (const [name, command, reason] of cases) {
    it(`refuses ${name} and never reaches sudo`, () => {
      const result = runEntry(command);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${USAGE}\n`);
      assert.equal(readIfExists(sudoCalls), "", "sudo was not called");
      assert.equal(readIfExists(logFile), `-t jadero-deploy -- refused reason=${reason}\n`);
    });
  }

  // The key line, never the client, names the environment: a leaked staging key reaches staging.
  for (const [name, binding] of [
    ["no binding", []],
    ["two bindings", ["staging", "prod"]],
    ["an unknown binding", ["dev"]],
  ]) {
    it(`refuses every command with ${name} on the key line`, () => {
      const result = runEntry("deploy staging api 0.4.1", { binding });
      assert.equal(result.status, 1);
      assert.equal(readIfExists(sudoCalls), "", "sudo was not called");
      assert.equal(readIfExists(logFile), "-t jadero-deploy -- refused reason=no-binding\n");
    });
  }

  it("refuses a staging command on the production key", () => {
    const result = runEntry("deploy staging api 0.4.1", { binding: ["prod"] });
    assert.equal(result.status, 1);
    assert.equal(readIfExists(sudoCalls), "");
    assert.equal(readIfExists(logFile), "-t jadero-deploy -- refused reason=env-mismatch\n");
  });

  it("never writes the client's input to the log", () => {
    runEntry("deploy staging api $(touch /tmp/pwned)");
    const log = readIfExists(logFile);
    assert.doesNotMatch(log, /touch|pwned|\$\(/);
  });
});

// sshd passes the client's LANG and LC_* (Ubuntu's AcceptEnv) and sudo keeps them; under a UTF-8
// locale glibc's [A-Za-z] matches non-ASCII letters, so both scripts pin LC_ALL=C first.
describe("a client's UTF-8 locale", () => {
  const LOCALES = [
    ["LANG and LC_CTYPE", { LANG: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" }],
    ["LC_ALL", { LC_ALL: "en_US.UTF-8" }],
  ];
  // A pre-release with a-umlaut, and one with a fullwidth r: both letters to a UTF-8 glibc.
  const NON_ASCII = ["1.0.0-rcä", "1.0.0-ｒc"];

  for (const [name, clientEnv] of LOCALES) {
    for (const version of NON_ASCII) {
      it(`deploy-entry refuses ${JSON.stringify(version)} with ${name} set`, () => {
        const result = runEntry(`deploy staging api ${version}`, { clientEnv });
        assert.equal(result.status, 1);
        assert.equal(result.stderr, `${USAGE}\n`);
        assert.equal(readIfExists(sudoCalls), "", "sudo was not called");
        assert.equal(readIfExists(logFile), "-t jadero-deploy -- refused reason=bad-characters\n");
      });

      it(`deploy.sh refuses ${JSON.stringify(version)} with ${name} set`, () => {
        const result = runDeploySh(["deploy", "staging", "api", version], clientEnv);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
      });
    }
  }

  for (const [name, path] of [
    ["deploy-entry", ENTRY],
    ["deploy.sh", DEPLOY_SH],
  ]) {
    it(`${name} exports LC_ALL=C before its first regex match`, () => {
      const lines = readFileSync(path, "utf8").split("\n");
      const pin = lines.indexOf("export LC_ALL=C");
      const firstMatch = lines.findIndex((line) => !line.startsWith("#") && line.includes("=~"));
      assert.ok(pin >= 0, `${name} sets LC_ALL=C`);
      assert.ok(firstMatch > pin, `${name} pins the locale before line ${firstMatch + 1}`);
    });
  }
});
