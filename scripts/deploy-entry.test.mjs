// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
//
// Tests the deploy user's forced command (`infra/scripts/deploy-entry`) and the stub it calls
// through sudo (`infra/scripts/deploy.sh`), WP-8 D3. The production scripts read no path from the
// environment, so each test run copies deploy-entry into a temporary folder and rewrites its three
// path constants to fakes: a sudo that records its arguments and runs the real deploy.sh stub, and
// a logger that appends to a file. The rewrite fails loudly if a constant is renamed, so a test can
// never reach the real sudo.
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
const USAGE = 'refused: expected "deploy <env> <service> <version>"';

let dir;
let entry;
let sudoCalls;
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
 * Runs the rewritten deploy-entry as sshd would, with the client's words in SSH_ORIGINAL_COMMAND.
 * @param {string | undefined} command the client's command, or undefined to leave it unset
 * @returns {{ status: number | null, stdout: string, stderr: string }} the result
 */
function runEntry(command) {
  for (const file of [sudoCalls, logFile]) rmSync(file, { force: true });
  const env = { PATH: process.env.PATH };
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command;
  const result = spawnSync(entry, [], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs the deploy.sh stub directly with the given arguments.
 * @param {string[]} args the arguments
 * @returns {{ status: number | null, stdout: string, stderr: string }} the result
 */
function runDeploySh(args) {
  const result = spawnSync(DEPLOY_SH, args, { env: { PATH: process.env.PATH }, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const readIfExists = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

before(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-entry-"));
  sudoCalls = join(dir, "sudo-calls");
  logFile = join(dir, "log");
  const sudo = writeScript(
    "fake-sudo",
    `printf '%s\\n' "$*" >> '${sudoCalls}'\n[ "$1" = "-n" ] && shift\nexec "$@"`,
  );
  const logger = writeScript("fake-logger", `printf '%s\\n' "$*" >> '${logFile}'`);
  let source = readFileSync(ENTRY, "utf8");
  source = rewriteConstant(source, "DEPLOY_SH", DEPLOY_SH);
  source = rewriteConstant(source, "SUDO", sudo);
  source = rewriteConstant(source, "LOGGER", logger);
  entry = writeScript("deploy-entry", source.replace(/^#!.*\n/, ""));
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("deploy-entry, accepted commands", () => {
  const cases = [
    ["deploy staging api 0.4.1", "would deploy api 0.4.1 to staging"],
    ["deploy prod agent 1.12.0", "would deploy agent 1.12.0 to prod"],
    ["deploy prod web 2.0.0-rc.1", "would deploy web 2.0.0-rc.1 to prod"],
    ["  deploy   staging  api  0.4.1  ", "would deploy api 0.4.1 to staging"],
  ];
  for (const [command, expected] of cases) {
    it(`runs deploy.sh through sudo -n for "${command}"`, () => {
      const result = runEntry(command);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `${expected}\n`);
      const [, service, version, env] = expected.match(/^would deploy (\S+) (\S+) to (\S+)$/);
      assert.equal(readIfExists(sudoCalls), `-n ${DEPLOY_SH} ${env} ${service} ${version}\n`);
      assert.equal(
        readIfExists(logFile),
        `-t jadero-deploy -- accepted env=${env} service=${service} version=${version}\n`,
      );
    });
  }
});

describe("deploy-entry, refused commands", () => {
  const cases = [
    ["unset", undefined, "empty"],
    ["empty", "", "empty"],
    ["only spaces", "   ", "word-count"],
    ["a shell", "bash", "word-count"],
    ["bad env", "deploy dev api 0.4.1", "bad-env"],
    ["env in capitals", "deploy STAGING api 0.4.1", "bad-env"],
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
    ["wrong verb", "remove staging api 0.4.1", "not-deploy"],
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

  it("never writes the client's input to the log", () => {
    runEntry("deploy staging api $(touch /tmp/pwned)");
    const log = readIfExists(logFile);
    assert.doesNotMatch(log, /touch|pwned|\$\(/);
  });
});

describe("deploy.sh stub", () => {
  it("prints the plan for valid arguments", () => {
    const result = runDeploySh(["staging", "api", "0.4.1"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "would deploy api 0.4.1 to staging\n");
  });

  const bad = [
    ["no arguments", []],
    ["two arguments", ["staging", "api"]],
    ["four arguments", ["staging", "api", "0.4.1", "extra"]],
    ["bad env", ["dev", "api", "0.4.1"]],
    ["unknown service", ["staging", "contact", "0.4.1"]],
    ["two services in one argument", ["staging", "api agent", "0.4.1"]],
    ["empty service", ["staging", "", "0.4.1"]],
    ["leading v", ["staging", "api", "v0.4.1"]],
    ["shell text in the version", ["staging", "api", "0.4.1;id"]],
    ["newline in the version", ["staging", "api", "0.4.1\nid"]],
  ];
  for (const [name, args] of bad) {
    it(`refuses ${name}`, () => {
      const result = runDeploySh(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, 'refused: expected "deploy.sh <env> <service> <version>"\n');
    });
  }
});
