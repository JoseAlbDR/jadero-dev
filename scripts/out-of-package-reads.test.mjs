// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  declares,
  effectiveInputs,
  outOfPackageReads,
  REPO_ROOT,
  scanRepository,
} from "./out-of-package-reads.mjs";

const rootFolders = new Set(["infra", "docs"]);
const reads = (source, path = "packages/testing/test/a.test.ts") =>
  outOfPackageReads({ source, path, packageDir: "packages/testing" }, rootFolders);

describe("outOfPackageReads", () => {
  it("resolves new URL(..., import.meta.url) against the file", () => {
    const source = `readFileSync(new URL("../../../infra/compose/compose.dev.yml", import.meta.url), "utf8")`;
    assert.deepEqual(reads(source), ["infra/compose/compose.dev.yml"]);
  });

  it("resolves join and resolve on import.meta.dirname or __dirname", () => {
    const source = [
      `join(import.meta.dirname, "../../..", "infra", "rabbitmq/definitions.json")`,
      `resolve(__dirname, "../../../docs/adr")`,
    ].join("\n");
    assert.deepEqual(reads(source), ["docs/adr", "infra/rabbitmq/definitions.json"]);
  });

  it("treats join from a top-level folder as a path from the repo root", () => {
    const source = `const SCRIPT = join("infra", "postgres", "provision.sql");`;
    assert.deepEqual(reads(source, "packages/testing/src/x.ts"), ["infra/postgres/provision.sql"]);
  });

  it("ignores reads inside the package and paths built from variables", () => {
    const source = [
      `new URL("../fixtures/a.json", import.meta.url)`,
      `join(import.meta.dirname, "../messages", \`\${locale}.json\`)`,
      `join(folder, "meta", "_journal.json")`,
      `join("src", "index.ts")`,
    ].join("\n");
    assert.deepEqual(reads(source), []);
  });
});

describe("effectiveInputs", () => {
  const root = { tasks: { test: { inputs: ["root"] }, "@jadero/api#test": { inputs: ["api"] } } };

  it("prefers the package's turbo.json, then the root's package entry, then the root task", () => {
    const packageConfig = { tasks: { test: { inputs: ["own"] } } };
    assert.deepEqual(effectiveInputs({ root, packageConfig }, "@jadero/api", "test"), ["own"]);
    assert.deepEqual(effectiveInputs({ root }, "@jadero/api", "test"), ["api"]);
    assert.deepEqual(effectiveInputs({ root }, "@jadero/agent", "test"), ["root"]);
    assert.equal(effectiveInputs({ root }, "@jadero/agent", "build"), null);
  });
});

describe("declares", () => {
  const dir = "packages/testing";

  it("matches $TURBO_ROOT$ globs from the repo root", () => {
    const inputs = ["$TURBO_DEFAULT$", "$TURBO_ROOT$/infra/compose/**"];
    assert.equal(declares(inputs, dir, "infra/compose/compose.dev.yml"), true);
    assert.equal(declares(inputs, dir, "infra/rabbitmq/definitions.json"), false);
  });

  it("never counts $TURBO_DEFAULT$ or the default inputs as a declaration", () => {
    assert.equal(declares(["$TURBO_DEFAULT$"], dir, "infra/compose/compose.dev.yml"), false);
    assert.equal(declares(null, dir, "infra/compose/compose.dev.yml"), false);
  });

  it("resolves package-relative globs and honors negations", () => {
    assert.equal(declares(["../../infra/**"], dir, "infra/a.yml"), true);
    assert.equal(declares(["../../infra/**", "!../../infra/a.yml"], dir, "infra/a.yml"), false);
  });

  it("matches a folder read as any file in it", () => {
    assert.equal(declares(["$TURBO_ROOT$/docs/adr/**"], dir, "docs/adr", true), true);
  });
});

describe("this repository", () => {
  const rows = scanRepository(REPO_ROOT);

  it("finds the reads it is known to have, so a broken scan cannot pass by finding nothing", () => {
    const found = rows.map((row) => `${row.packageName}#${row.task} ${row.read}`);
    for (const known of [
      "@jadero/testing#test infra/compose/compose.dev.yml",
      "@jadero/testing#test infra/postgres/provision.sql",
      "@jadero/messaging#test infra/compose/compose.dev.yml",
      "@jadero/messaging#test infra/rabbitmq/definitions.json",
      "@jadero/agent#test:int infra/postgres/provision.sql",
      "@jadero/api#test:int infra/postgres/provision.sql",
    ]) {
      assert.ok(found.includes(known), `expected the scan to find ${known}`);
    }
  });

  it("declares every file a test reads outside its package in the reading task's inputs", () => {
    const undeclared = rows
      .filter((row) => !row.declared)
      .map(
        (row) =>
          `${row.file} reads ${row.read}: add "$TURBO_ROOT$/${row.read}" (or a glob over it) to the inputs of ${row.packageName}#${row.task} in ${row.packageDir}/turbo.json, keeping "$TURBO_DEFAULT$"`,
      );
    assert.deepEqual(undeclared, []);
  });
});
