import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { collectRows, main, readPct, renderTable } from "./coverage-summary.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "coverage-summary-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Writes a package with a manifest and, optionally, a coverage summary.
 * @param {string} path the package folder, relative to the fake root.
 * @param {string} name the package name.
 * @param {string | undefined} summary the raw `coverage-summary.json` text.
 */
function writePackage(path, name, summary) {
  mkdirSync(join(root, path, "coverage"), { recursive: true });
  writeFileSync(join(root, path, "package.json"), JSON.stringify({ name }));
  if (summary !== undefined)
    writeFileSync(join(root, path, "coverage", "coverage-summary.json"), summary);
}

const summary = (lines, branches) =>
  JSON.stringify({ total: { lines: { pct: lines }, branches: { pct: branches } } });

describe("coverage summary table (ADR-009, reported per package in CI)", () => {
  it("makes one row per package that has a summary, sorted by name", () => {
    writePackage("packages/messaging", "@jadero/messaging", summary(95.52, 84.31));
    writePackage("apps/api", "@jadero/api", summary(82.72, 81.78));
    writePackage("packages/ui", "@jadero/ui", undefined);
    assert.deepEqual(collectRows(root), [
      { name: "@jadero/api", lines: 82.72, branches: 81.78 },
      { name: "@jadero/messaging", lines: 95.52, branches: 84.31 },
    ]);
  });

  it("keeps a row with n/a for a summary it cannot read, instead of failing the step", () => {
    writePackage("apps/agent", "@jadero/agent", "{not json");
    const rows = collectRows(root);
    assert.deepEqual(rows, [{ name: "@jadero/agent", lines: null, branches: null }]);
    assert.match(renderTable(rows), /\| @jadero\/agent \| n\/a \| n\/a \|/);
  });

  it("says so when no package's tests ran (nothing affected), and does not fail", () => {
    assert.equal(
      renderTable(collectRows(root)),
      "### Unit test coverage\n\nNo coverage summary: no package's tests ran.\n",
    );
  });

  it("appends the table to the file GITHUB_STEP_SUMMARY names", () => {
    writePackage("apps/api", "@jadero/api", summary(90, 85));
    const file = join(root, "step-summary.md");
    writeFileSync(file, "earlier step\n");
    main({ GITHUB_STEP_SUMMARY: file }, root);
    assert.equal(
      readFileSync(file, "utf8"),
      "earlier step\n### Unit test coverage\n\n| Package | Lines | Branches |\n|---|---:|---:|\n| @jadero/api | 90% | 85% |\n\n",
    );
  });

  it("reads only finite numbers as percentages", () => {
    assert.equal(readPct({ lines: { pct: 80 } }, "lines"), 80);
    assert.equal(readPct({ lines: { pct: "80" } }, "lines"), null);
    assert.equal(readPct(undefined, "branches"), null);
  });
});
