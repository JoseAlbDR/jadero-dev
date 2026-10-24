// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  checkRepository,
  composeEntries,
  DEPLOY_COMPOSE,
  DEPLOY_FILES,
  deployHashes,
  productionClosure,
  renderReleaseInputs,
} from "./release-inputs.mjs";

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

  it("leaves type packages out but keeps the runtime packages reached through them", () => {
    const typed = {
      importers: {
        "apps/app": {
          dependencies: { instrumentation: { specifier: "catalog:", version: "1.0.0" } },
        },
      },
      snapshots: {
        "instrumentation@1.0.0": { dependencies: { "@types/x": "2.0.0" } },
        "@types/x@2.0.0": { dependencies: { "@types/node": "24.0.0", "x-runtime": "3.0.0" } },
        "@types/node@24.0.0": {},
        "x-runtime@3.0.0": {},
      },
    };
    const closure = productionClosure(typed, "apps/app");
    assert.deepEqual(
      closure.filter((line) => line.startsWith("@types/")),
      [],
    );
    assert.deepEqual(closure, ["instrumentation@1.0.0", "x-runtime@3.0.0"]);
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

  it("appends the deploy files after a comment, one path and hash per line", () => {
    const text = renderReleaseInputs("app", ["a@1.0.0"], [{ path: "infra/x", hash: "sha256:00" }]);
    const [, ...lines] = text.trimEnd().split("\n");
    assert.equal(lines[0], "a@1.0.0");
    assert.match(lines[1], /^# Deploy files, .*ADR-053/);
    assert.equal(lines[2], "infra/x sha256:00");
  });
});

const SERVICES = `x-hardened: &hardened
  read_only: true
services:
  api:
    <<: *hardened
    image: \${API_IMAGE:?}
  api-worker:
    image: \${API_IMAGE:?}
  web:
    image: \${WEB_IMAGE:?}
`;

describe("composeEntries", () => {
  it("keeps the service's process types with anchors merged, and drops comments and others", () => {
    const entries = JSON.parse(composeEntries(SERVICES, "api"));
    assert.deepEqual(Object.keys(entries.services), ["api", "api-worker"]);
    assert.equal(entries.services.api.read_only, true);
    const commented = SERVICES.replace("services:", "# a new comment\nservices:");
    assert.equal(composeEntries(commented, "api"), composeEntries(SERVICES, "api"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable, not a JS placeholder
    const webChanged = SERVICES.replace("${WEB_IMAGE:?}", "${WEB_IMAGE:?set it}");
    assert.equal(composeEntries(webChanged, "api"), composeEntries(SERVICES, "api"));
    assert.notEqual(composeEntries(webChanged, "web"), composeEntries(SERVICES, "web"));
  });

  it("changes when an anchor the service merges changes, and keeps the overlay's top level", () => {
    const anchor = SERVICES.replace("read_only: true", "read_only: false");
    assert.notEqual(composeEntries(anchor, "api"), composeEntries(SERVICES, "api"));
    const overlay = "name: jadero-staging\nnetworks:\n  default:\n    name: jadero_staging\n";
    assert.match(composeEntries(overlay, "web"), /"name":"jadero-staging"/);
  });
});

describe("deployHashes", () => {
  const root = mkdtempSync(join(tmpdir(), "release-inputs-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const path of DEPLOY_COMPOSE) write(path, SERVICES);
  for (const path of DEPLOY_FILES.api) {
    if (path.endsWith("/definitions")) write(`${path}/prod.json`, "{}");
    else write(path, `${path}\n`);
  }

  it("lists each Compose file for the service, then each file, a folder expanded", () => {
    const paths = deployHashes("api", root).map(({ path }) => path);
    assert.deepEqual(
      paths.slice(0, 3),
      DEPLOY_COMPOSE.map((path) => `${path}#api`),
    );
    assert.ok(paths.includes("infra/env/api.env.tpl"));
    assert.ok(paths.includes("infra/rabbitmq/server/definitions/prod.json"));
    write("infra/rabbitmq/server/definitions/staging.json", "{}");
    assert.ok(
      deployHashes("api", root).some(({ path }) => path.endsWith("definitions/staging.json")),
    );
  });

  it("changes a line's hash when its file changes, and fails on a missing file", () => {
    const before = deployHashes("api", root);
    write("infra/env/api.env.tpl", "LOG_LEVEL=debug\n");
    const changed = deployHashes("api", root).filter(
      (line, index) => line.hash !== before[index].hash,
    );
    assert.deepEqual(
      changed.map(({ path }) => path),
      ["infra/env/api.env.tpl"],
    );
    assert.throws(() => deployHashes("web", root), /ENOENT/);
  });
});
