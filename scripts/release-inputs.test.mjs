// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRepository, productionClosure, renderReleaseInputs } from "./release-inputs.mjs";

/** A small lockfile: one app on two workspace packages, peers, an alias and dev-only entries. */
const LOCK = {
  importers: {
    "apps/app": {
      dependencies: {
        "@jadero/shared": { specifier: "workspace:*", version: "link:../../packages/shared" },
        framework: { specifier: "catalog:", version: "2.0.0(peer@1.0.0)" },
      },
      devDependencies: {
        "@jadero/tooling": { specifier: "workspace:*", version: "link:../../packages/tooling" },
        tester: { specifier: "catalog:", version: "9.0.0" },
      },
    },
    "packages/shared": {
      dependencies: { framework: { specifier: "catalog:", version: "2.0.0(peer@2.0.0)" } },
      optionalDependencies: { native: { specifier: "catalog:", version: "1.1.0" } },
      devDependencies: { tester: { specifier: "catalog:", version: "9.0.0" } },
    },
    "packages/tooling": { dependencies: { lint: { specifier: "catalog:", version: "3.0.0" } } },
  },
  snapshots: {
    "framework@2.0.0(peer@1.0.0)": { dependencies: { peer: "1.0.0", "strip-cjs": "strip@6.0.1" } },
    "framework@2.0.0(peer@2.0.0)": { dependencies: { peer: "2.0.0" } },
    "peer@1.0.0": {},
    "peer@2.0.0": {},
    "strip@6.0.1": {},
    "native@1.1.0": {},
    "tester@9.0.0": {},
    "lint@3.0.0": {},
  },
};

describe("the repository's release-inputs files", () => {
  it("match the production dependencies in pnpm-lock.yaml (else run `pnpm release-inputs`)", () => {
    assert.deepEqual(checkRepository(), []);
  });
});

describe("productionClosure", () => {
  it("follows workspace links and transitive production dependencies, never dev ones", () => {
    assert.deepEqual(productionClosure(LOCK, "apps/app"), [
      "framework@2.0.0",
      "native@1.1.0",
      "peer@1.0.0",
      "peer@2.0.0",
      "strip@6.0.1",
    ]);
  });

  it("fails loudly when the lockfile misses a snapshot", () => {
    const broken = { ...LOCK, snapshots: { ...LOCK.snapshots, "peer@2.0.0": undefined } };
    assert.throws(() => productionClosure(broken, "apps/app"), /no snapshot "peer@2.0.0"/);
  });
});

describe("renderReleaseInputs", () => {
  it("writes a generated header naming the command, then one package per line", () => {
    const text = renderReleaseInputs("app", ["a@1.0.0", "b@2.0.0"]);
    const [header, ...lines] = text.trimEnd().split("\n");
    assert.match(header, /^# Generated .*@jadero\/app.*`pnpm release-inputs`/);
    assert.deepEqual(lines, ["a@1.0.0", "b@2.0.0"]);
  });
});
