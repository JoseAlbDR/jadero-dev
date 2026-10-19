/**
 * Writes and checks `apps/<service>/release-inputs.txt` (WP-7 Q2, ADR-049 "Dependency-only
 * releases"). release-please gives a commit to a service only through the files it touches, and a
 * dependency update touches only the root catalog and lockfile. This file lists the service's
 * production dependency closure (`name@version`, one per line, sorted, workspace packages left out
 * because the `node-workspace` plugin covers them), so a dependency pull request that regenerates
 * it touches exactly the services whose image changes, and a `fix(deps)` title releases them.
 *
 * Since WP-9 (ADR-053) it also lists a content hash of the service's deploy files, which the server
 * fetches at the release tag: its process types' entries in the servers' Compose files, its env
 * template, and for `api` and `agent` the provisioning and RabbitMQ topology files their deploy
 * applies. `infra/` belongs to no release component, so without these lines a change there would
 * reach the server only with the next unrelated release; with them, a commit that changes a deploy
 * file and regenerates this file releases exactly the services that read it. A Compose entry is
 * hashed after YAML parsing (anchors merged, comments dropped), so a comment or another service's
 * entry changes nothing.
 *
 * Read from `pnpm-lock.yaml` and those files only: offline and deterministic, whatever is
 * installed. A stale file fails `scripts/release-inputs.test.mjs` (`pnpm test:scripts`, so
 * `pnpm verify`): a generated file with a staleness test. Regenerate with `pnpm release-inputs`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The services that ship an image and are release components. */
export const SERVICES = ["agent", "api", "web"];

/** The command that regenerates the files, named in the header and in every failure. */
export const COMMAND = "pnpm release-inputs";

/**
 * The servers' Compose files (WP-9 step 2): each service's deploy covers the entries of its own
 * process types (`api`, `api-*`) and the overlays' project name and network.
 */
export const DEPLOY_COMPOSE = [
  "infra/compose/compose.services.yml",
  "infra/compose/compose.staging.yml",
  "infra/compose/compose.prod.yml",
];

/**
 * What an `api` or `agent` deploy applies besides its own template (ADR-053): its Postgres roles,
 * its broker user and permissions, and the topology of its release (every file of the folder).
 */
const PROVISIONING = [
  "infra/postgres/provision.sql",
  "infra/rabbitmq/provision-users.sh",
  "infra/rabbitmq/import-definitions.sh",
  "infra/rabbitmq/server/permissions.tsv",
  "infra/rabbitmq/server/definitions",
];

/** The deploy files of each service, besides its Compose entries; a folder means every file in it. */
export const DEPLOY_FILES = {
  agent: ["infra/env/agent.env.tpl", ...PROVISIONING],
  api: ["infra/env/api.env.tpl", ...PROVISIONING],
  web: ["infra/env/web.env.tpl"],
};

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
 * Serializes a parsed YAML value with sorted keys, so equal content always gives equal text.
 * @param value the parsed value.
 * @returns its canonical JSON.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The SHA-256 of a text or a buffer, as `sha256:<hex>`. */
function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * The part of a Compose file that belongs to one service's deploy: its process types' entries,
 * anchors merged, and the file's top-level keys other than the `x-` anchors and the services.
 * @param source the Compose file's text.
 * @param service the service name, such as `api`.
 * @returns the canonical JSON of that part.
 */
export function composeEntries(source, service) {
  const document = parse(source, { merge: true }) ?? {};
  const own = Object.entries(document.services ?? {}).filter(
    ([name]) => name === service || name.startsWith(`${service}-`),
  );
  const rest = Object.entries(document).filter(
    ([key]) => key !== "services" && !key.startsWith("x-"),
  );
  return canonicalJson({ ...Object.fromEntries(rest), services: Object.fromEntries(own) });
}

/**
 * Hashes the deploy files of one service (ADR-053): one line per Compose file with its entries,
 * then one per file of {@link DEPLOY_FILES} (a folder expands to its files, sorted).
 * @param service the service name, such as `api`.
 * @param root the repository root.
 * @returns one `{ path, hash }` per line, `path` relative to the root (`<file>#<service>` for a
 *   Compose file).
 * @throws Error when a listed file or folder is missing.
 */
export function deployHashes(service, root = REPO_ROOT) {
  const compose = DEPLOY_COMPOSE.map((path) => ({
    path: `${path}#${service}`,
    hash: sha256(composeEntries(readFileSync(join(root, path), "utf8"), service)),
  }));
  const files = (DEPLOY_FILES[service] ?? []).flatMap((path) =>
    statSync(join(root, path)).isDirectory()
      ? readdirSync(join(root, path))
          .sort()
          .map((name) => posix.join(path, name))
      : [path],
  );
  return [
    ...compose,
    ...files.map((path) => ({ path, hash: sha256(readFileSync(join(root, path))) })),
  ];
}

/**
 * Renders the content of one `release-inputs.txt`.
 * @param service the service name, such as `api`.
 * @param packages the closure from {@link productionClosure}.
 * @param deploy the deploy file hashes from {@link deployHashes}; none leaves the section out.
 * @returns the file's text: a one-line generated header, one `name@version` per line, then a
 *   comment and one `<path> sha256:<hex>` per deploy file.
 */
export function renderReleaseInputs(service, packages, deploy = []) {
  const header = `# Generated from pnpm-lock.yaml and the deploy files by scripts/release-inputs.mjs (production dependencies of @jadero/${service}, then its deploy files). Do not edit: run \`${COMMAND}\`.`;
  const section =
    deploy.length === 0
      ? []
      : [
          "# Deploy files, fetched at the release tag (ADR-053): a change to one releases the service.",
          ...deploy.map(({ path, hash }) => `${path} ${hash}`),
        ];
  return `${[header, ...packages, ...section].join("\n")}\n`;
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
    const deploy = deployHashes(service, root);
    return {
      path: `apps/${service}/release-inputs.txt`,
      content: renderReleaseInputs(service, packages, deploy),
      count: packages.length,
      deployCount: deploy.length,
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
  for (const { path, content, count, deployCount } of expectedFiles()) {
    writeFileSync(join(REPO_ROOT, path), content);
    console.log(`${path}: ${count} packages, ${deployCount} deploy files`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
