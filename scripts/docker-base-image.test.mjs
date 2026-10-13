// Runs with the Node test runner (`node --test`), like the other scripts: no dependencies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBasePins, checkRepository } from "./docker-base-image.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const dockerfile = (pin) =>
  [`ARG NODE_IMAGE=${pin}`, "FROM ${NODE_IMAGE} AS build", "FROM ${NODE_IMAGE} AS runtime"].join(
    "\n",
  );

describe("the repository's Dockerfiles", () => {
  it("share one base pinned by digest, on the Node version of .nvmrc", () => {
    const { paths, problems } = checkRepository();
    assert.ok(paths.includes("apps/api/Dockerfile"), "apps/api/Dockerfile is checked");
    assert.deepEqual(problems, []);
  });
});

describe("checkBasePins", () => {
  const pin = `node:24.21.0-trixie-slim@${DIGEST}`;

  it("accepts the same pin everywhere on the .nvmrc version", () => {
    const files = [
      { path: "apps/a/Dockerfile", source: dockerfile(pin) },
      { path: "apps/b/Dockerfile", source: dockerfile(pin) },
    ];
    assert.deepEqual(checkBasePins(files, "24.21.0\n"), []);
  });

  it("fails when the Node version drifts from .nvmrc", () => {
    const files = [{ path: "apps/a/Dockerfile", source: dockerfile(pin) }];
    assert.deepEqual(checkBasePins(files, "24.22.0\n"), [
      "apps/a/Dockerfile: Node 24.21.0 differs from .nvmrc (24.22.0)",
    ]);
  });

  it("fails when two Dockerfiles pin different bases", () => {
    const other = `node:24.21.0-trixie-slim@sha256:${"b".repeat(64)}`;
    const files = [
      { path: "apps/a/Dockerfile", source: dockerfile(pin) },
      { path: "apps/b/Dockerfile", source: dockerfile(other) },
    ];
    assert.match(checkBasePins(files, "24.21.0").join("\n"), /pin different bases/);
  });

  it("fails on a tag without a digest, a missing pin or a FROM that skips it", () => {
    const files = [
      { path: "apps/a/Dockerfile", source: dockerfile("node:24.21.0-trixie-slim") },
      { path: "apps/b/Dockerfile", source: "FROM node:24-slim" },
    ];
    assert.deepEqual(checkBasePins(files, "24.21.0"), [
      "apps/a/Dockerfile: NODE_IMAGE must be node:<x.y.z>-<variant>@sha256:<digest>",
      "apps/b/Dockerfile: expected one ARG NODE_IMAGE, found 0",
      'apps/b/Dockerfile: "FROM node:24-slim" must build FROM ${NODE_IMAGE}',
    ]);
  });
});
