/**
 * Checks the base image pin of the service Dockerfiles (WP-7 D3, ADR-042). Every
 * `apps/<service>/Dockerfile` declares the base once, as `ARG NODE_IMAGE=node:<version>-<variant>@sha256:<digest>`,
 * and every `FROM` uses that argument. All Dockerfiles carry the same pin, and its Node version
 * equals `.nvmrc`, so dev, CI and the images run the same Node: an environment-parity check, like
 * the Postgres tag test of `@jadero/testing`.
 *
 * Run by `scripts/docker-base-image.test.mjs` through `pnpm test:scripts`, so `pnpm verify`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** `ARG NODE_IMAGE=node:<version>-<variant>@sha256:<64 hex>`, the only accepted base declaration. */
const PIN = /^ARG NODE_IMAGE=(node:(\d+\.\d+\.\d+)-[a-z0-9-]+@sha256:[0-9a-f]{64})$/;

/**
 * Lists the service Dockerfiles, one per app folder that has one.
 * @param root the repository root.
 * @returns the paths relative to the root, sorted.
 */
export function serviceDockerfiles(root = REPO_ROOT) {
  const apps = join(root, "apps");
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(apps, entry.name, "Dockerfile")))
    .map((entry) => `apps/${entry.name}/Dockerfile`)
    .sort();
}

/**
 * Reads the base image pin of one Dockerfile and lists what breaks the rule.
 * @param path the Dockerfile's path, for the messages.
 * @param source the Dockerfile's text.
 * @returns the pinned reference and Node version (null when there is no single valid pin) and the problems found.
 */
export function readBasePin(path, source) {
  const lines = source.split("\n").map((line) => line.trim());
  const declarations = lines.filter((line) => line.startsWith("ARG NODE_IMAGE"));
  const problems = [];
  const match = declarations.length === 1 ? PIN.exec(declarations[0]) : null;
  if (declarations.length !== 1) {
    problems.push(`${path}: expected one ARG NODE_IMAGE, found ${declarations.length}`);
  } else if (!match) {
    problems.push(`${path}: NODE_IMAGE must be node:<x.y.z>-<variant>@sha256:<digest>`);
  }
  for (const from of lines.filter((line) => /^FROM\s/i.test(line))) {
    if (!/^FROM \$\{NODE_IMAGE\}( AS \S+)?$/i.test(from)) {
      problems.push(`${path}: "${from}" must build FROM \${NODE_IMAGE}`);
    }
  }
  return { image: match?.[1] ?? null, nodeVersion: match?.[2] ?? null, problems };
}

/**
 * Checks every service Dockerfile against each other and against `.nvmrc`.
 * @param files the Dockerfiles, as `{ path, source }`.
 * @param nvmrc the content of `.nvmrc`.
 * @returns the problems found; empty when every pin is valid, shared and on the `.nvmrc` version.
 */
export function checkBasePins(files, nvmrc) {
  const expected = nvmrc.trim().replace(/^v/, "");
  const pins = files.map(({ path, source }) => ({ path, ...readBasePin(path, source) }));
  const problems = pins.flatMap((pin) => pin.problems);
  for (const pin of pins.filter((p) => p.nodeVersion && p.nodeVersion !== expected)) {
    problems.push(`${pin.path}: Node ${pin.nodeVersion} differs from .nvmrc (${expected})`);
  }
  const images = new Set(pins.map((pin) => pin.image).filter(Boolean));
  if (images.size > 1) {
    problems.push(`the Dockerfiles pin different bases: ${[...images].sort().join(", ")}`);
  }
  return problems;
}

/**
 * Reads the repository's Dockerfiles and `.nvmrc` and checks them.
 * @param root the repository root.
 * @returns the Dockerfiles checked and the problems found.
 */
export function checkRepository(root = REPO_ROOT) {
  const paths = serviceDockerfiles(root);
  const files = paths.map((path) => ({ path, source: readFileSync(join(root, path), "utf8") }));
  return { paths, problems: checkBasePins(files, readFileSync(join(root, ".nvmrc"), "utf8")) };
}
