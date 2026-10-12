/**
 * Writes and checks `apps/<service>/release-inputs.txt` (WP-7 Q2, ADR-049 "Dependency-only
 * releases"). release-please gives a commit to a service only through the files it touches, and a
 * dependency update touches only the root catalog and lockfile. This file lists the service's
 * production dependency closure (`name@version`, one per line, sorted, workspace packages left out
 * because the `node-workspace` plugin covers them), so a dependency pull request that regenerates
 * it touches exactly the services whose image changes, and a `fix(deps)` title releases them.
 *
 * Read from `pnpm-lock.yaml` only: offline and deterministic, whatever is installed. A stale file
 * fails `scripts/release-inputs.test.mjs` (`pnpm test:scripts`, so `pnpm verify`): a generated
 * file with a staleness test. Regenerate with `pnpm release-inputs`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The services that ship an image and are release components. */
export const SERVICES = ["agent", "api", "web"];

/** The command that regenerates the files, named in the header and in every failure. */
export const COMMAND = "pnpm release-inputs";

/** The dependency fields that reach a production install (`pnpm deploy --prod`). */
const PROD_FIELDS = ["dependencies", "optionalDependencies"];

/**
 * Turns a lockfile dependency entry into its snapshot key, or a workspace path for `link:`.
 * @param name the dependency's name as declared (an alias for `npm:` aliases).
 * @param version the resolved version from the lockfile, peers suffix included.
 * @param from the importer path the entry belongs to, to resolve `link:` targets.
 * @returns `{ workspace }` for a workspace link, else `{ key }` for the `snapshots` map.
 */
function resolveEntry(name, version, from) {
  if (version.startsWith("link:")) return { workspace: posix.join(from, version.slice(5)) };
  // An alias resolves to "<real name>@<version>"; a plain version starts with a digit or a scheme.
  if (/^\d/.test(version) || /^(file|https?|git)[:+]/.test(version)) {
    return { key: `${name}@${version}` };
  }
  return { key: version };
}

/**
 * Lists the production dependency closure of one workspace package from the parsed lockfile.
 * @param lock the parsed `pnpm-lock.yaml` (v9: `importers` and `snapshots`).
 * @param importer the package's path in the workspace, such as `apps/api`.
 * @returns every third-party package it runs with, as `name@version` (no peer suffix), sorted.
 */
export function productionClosure(lock, importer) {
  const seenImporters = new Set();
  const seenKeys = new Set();
  const pending = [];
  const visitImporter = (path) => {
    if (seenImporters.has(path)) return;
    seenImporters.add(path);
    const entry = lock.importers?.[path];
    if (!entry) throw new Error(`pnpm-lock.yaml has no importer "${path}"`);
    for (const field of PROD_FIELDS) {
      for (const [name, { version }] of Object.entries(entry[field] ?? {})) {
        const resolved = resolveEntry(name, version, path);
        if (resolved.workspace) visitImporter(resolved.workspace);
        else pending.push(resolved.key);
      }
    }
  };
  visitImporter(importer);
  while (pending.length > 0) {
    const key = pending.pop();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const snapshot = lock.snapshots?.[key];
    if (snapshot === undefined) throw new Error(`pnpm-lock.yaml has no snapshot "${key}"`);
    for (const field of PROD_FIELDS) {
      for (const [name, version] of Object.entries(snapshot?.[field] ?? {})) {
        const resolved = resolveEntry(name, version, importer);
        if (resolved.key) pending.push(resolved.key);
      }
    }
  }
  // "@nestjs/core@12.1.2(peers...)" and its other peer variants are one package version.
  const packages = new Set([...seenKeys].map((key) => key.replace(/\(.*$/, "")));
  return [...packages].sort();
}

/**
 * Renders the content of one `release-inputs.txt`.
 * @param service the service name, such as `api`.
 * @param packages the closure from {@link productionClosure}.
 * @returns the file's text: a one-line generated header, then one `name@version` per line.
 */
export function renderReleaseInputs(service, packages) {
  const header = `# Generated from pnpm-lock.yaml by scripts/release-inputs.mjs (production dependencies of @jadero/${service}). Do not edit: run \`${COMMAND}\`.`;
  return `${[header, ...packages].join("\n")}\n`;
}

/**
 * Computes the expected file of every service from the repository's lockfile.
 * @param root the repository root.
 * @returns one `{ path, content, count }` per service, `path` relative to the root.
 */
export function expectedFiles(root = REPO_ROOT) {
  const lock = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  return SERVICES.map((service) => {
    const packages = productionClosure(lock, `apps/${service}`);
    return {
      path: `apps/${service}/release-inputs.txt`,
      content: renderReleaseInputs(service, packages),
      count: packages.length,
    };
  });
}

/**
 * Compares the committed files with the lockfile.
 * @param root the repository root.
 * @returns the problems found, each naming the file and the command that fixes it; empty when current.
 */
export function checkRepository(root = REPO_ROOT) {
  return expectedFiles(root).flatMap(({ path, content }) => {
    let actual;
    try {
      actual = readFileSync(join(root, path), "utf8");
    } catch {
      return [`${path} is missing: run \`${COMMAND}\``];
    }
    return actual === content ? [] : [`${path} is stale: run \`${COMMAND}\``];
  });
}

/** Writes every service's file and prints one line per file. */
function main() {
  for (const { path, content, count } of expectedFiles()) {
    writeFileSync(join(REPO_ROOT, path), content);
    console.log(`${path}: ${count} packages`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
