import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { classify, isNotNewerRefusal, lastLine, main } from "./deploy-result.mjs";

const RELEASE = {
  event: "workflow_call",
  action: "deploy",
  serverEnv: "staging",
  service: "api",
  version: "0.3.0",
};
const NOT_NEWER = "2026-10-24T10:00:00Z staging api 0.3.0 refused reason=not-newer";
const journalEnding = (/** @type {string} */ line) =>
  `2026-10-24T09:59:59Z staging api 0.3.0 checked ok\n${line}\n`;

describe("deploy-result, the not-newer refusal on a release call", () => {
  it("is a notice and exit 0 for the exact journal line", () => {
    const result = classify({ ...RELEASE, code: "1", journal: journalEnding(NOT_NEWER) });
    assert.equal(result.exitCode, 0);
    assert.match(result.message, /^::notice::api 0\.3\.0 not deployed to staging: /);
  });

  it("stays an error for a near-miss line", () => {
    for (const line of [
      "2026-10-24T10:00:00Z staging api 0.3.0 refused reason=locked",
      "2026-10-24T10:00:00Z staging api 0.3.0 refused reason=not-newer-than",
      "2026-10-24T10:00:00Z staging api 0.3.0 refused reason=not-newer extra",
      "staging api 0.3.0 refused reason=not-newer",
      "2026-10-24T10:00:00Z staging api 0.3.1 refused reason=not-newer",
      "2026-10-24T10:00:00Z prod api 0.3.0 refused reason=not-newer",
      "2026-10-24T10:00:00Z staging agent 0.3.0 refused reason=not-newer",
      "2026-10-24T10:00:00Z staging api 0.3.0 aborted reason=not-newer",
      "2026-10-24T10:00:00Z  staging api 0.3.0 refused reason=not-newer",
      "x reason=not-newer staging api 0.3.0 refused",
    ]) {
      const result = classify({ ...RELEASE, code: "1", journal: journalEnding(line) });
      assert.equal(result.exitCode, 1, line);
      assert.match(result.message, /^::error::/, line);
    }
  });

  it("stays an error when the exact line is not the last one", () => {
    const journal = `${NOT_NEWER}\n2026-10-24T10:00:01Z staging api 0.3.0 aborted reason=x\n`;
    const result = classify({ ...RELEASE, code: "1", journal });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /^::error::aborted before the point of no return/);
  });

  it("stays an error for the same exact line on a manual dispatch", () => {
    const result = classify({
      ...RELEASE,
      event: "workflow_dispatch",
      code: "1",
      journal: journalEnding(NOT_NEWER),
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /^::error::refused by the server: nothing was touched/);
  });

  it("matches only exactly six fields split on single spaces", () => {
    assert.equal(isNotNewerRefusal(NOT_NEWER, RELEASE), true);
    assert.equal(isNotNewerRefusal(`${NOT_NEWER} `, RELEASE), false);
    assert.equal(isNotNewerRefusal(NOT_NEWER.replace(" refused", "\trefused"), RELEASE), false);
    assert.equal(isNotNewerRefusal(NOT_NEWER, { ...RELEASE, version: "" }), false);
  });
});

describe("deploy-result, the exit code mappings", () => {
  it("maps 0 to recorded, exit 0", () => {
    assert.deepEqual(classify({ ...RELEASE, code: "0", journal: "" }), {
      message: "api: deploy on staging recorded",
      exitCode: 0,
    });
  });

  it("maps 75 to busy, exit 1", () => {
    const result = classify({ ...RELEASE, code: "75", journal: "" });
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.message,
      "::error::busy: another deploy holds the staging lock; nothing was touched, rerun once it ends",
    );
  });

  it("maps 1 to an error named by the last journal line's state", () => {
    for (const [state, start] of [
      ["aborted", "aborted before the point of no return"],
      ["rolled_back", "rolled back: the new release failed"],
      ["failed", "FAILED: the rollback did not get healthy either"],
      ["refused", "refused by the server: nothing was touched"],
    ]) {
      const line = `2026-10-24T10:00:00Z staging api 0.3.0 ${state} reason=x`;
      const result = classify({ ...RELEASE, code: "1", journal: journalEnding(line) });
      assert.equal(result.exitCode, 1, state);
      assert.ok(result.message.startsWith(`::error::${start}`), result.message);
    }
    const empty = classify({ ...RELEASE, code: "1", journal: "" });
    assert.equal(empty.exitCode, 1);
    assert.match(empty.message, /^::error::refused before the journal/);
  });

  it("maps 255 by whether the server printed anything, and any other code to unexpected", () => {
    assert.match(
      classify({ ...RELEASE, code: "255", journal: journalEnding("x") }).message,
      /^::error::the SSH session dropped mid-deploy/,
    );
    assert.match(
      classify({ ...RELEASE, code: "255", journal: "" }).message,
      /^::error::SSH failed before the server answered/,
    );
    assert.deepEqual(classify({ ...RELEASE, code: "2", journal: "" }), {
      message: "::error::unexpected exit 2 from the server",
      exitCode: 1,
    });
  });

  it("reads the last line as tail -n 1 does", () => {
    assert.equal(lastLine("a\nb\n"), "b");
    assert.equal(lastLine("a\nb"), "b");
    assert.equal(lastLine(""), "");
  });
});

describe("deploy-result, main", () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-result-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the journal file and the step's environment, and sets the exit status", () => {
    const journal = join(dir, "journal");
    writeFileSync(journal, journalEnding(NOT_NEWER));
    const env = {
      CODE: "1",
      JOURNAL: journal,
      EVENT: "workflow_call",
      ACTION: "deploy",
      SERVER_ENV: "staging",
      SERVICE: "api",
      VERSION: "0.3.0",
    };
    const write = process.stdout.write;
    /** @type {string[]} */
    const out = [];
    process.stdout.write = (/** @type {string} */ chunk) => out.push(chunk) > 0;
    try {
      assert.equal(main(env), 0);
      assert.equal(main({ ...env, EVENT: "workflow_dispatch" }), 1);
      assert.equal(main({ ...env, JOURNAL: join(dir, "missing") }), 1);
    } finally {
      process.stdout.write = write;
      process.exitCode = 0;
    }
    assert.match(out[0], /^::notice::/);
    assert.match(out[1], /^::error::refused by the server/);
    assert.match(out[2], /^::error::refused before the journal/);
  });
});
