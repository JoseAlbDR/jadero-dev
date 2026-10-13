/**
 * Checks the hardened runtime Compose file (WP-7 step 5; ADR-049 restating ADR-048 "Images";
 * ADR-027 memory budget and port binding; docs/learning/wp-7.md D2, D4, D5). Every service of
 * `infra/compose/compose.images.yml` runs read-only, without capabilities, without new privileges,
 * with a size-capped `/tmp` and a memory limit, and publishes ports on 127.0.0.1 only. No service
 * gains a privilege back: no `privileged`, no `cap_add`, no root user, no host network, PID or IPC
 * namespace, no Docker socket. A long-running service keeps its heap plus every tmpfs at most 80%
 * of its limit (tmpfs pages count against `mem_limit`) and starts only after its own migrate step
 * completed; a one-off migrate never restarts and has no healthcheck. A fitness function:
 * the rules hold by test, not by review, like dependency-cruiser for imports.
 *
 * Run by `scripts/compose-hardening.test.mjs` through `pnpm test:scripts`, so `pnpm verify`. The
 * file is read with the `yaml` package, merge keys on (`<<: *hardened`), as Compose reads it.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The Compose file that runs the production images, relative to the root. */
export const COMPOSE_IMAGES = "infra/compose/compose.images.yml";

/** The smallest share of `mem_limit` that `--max-old-space-size` may take (ADR-027: about 75%). */
const HEAP_MIN_SHARE = 0.6;

/**
 * The largest share of `mem_limit` that the heap plus every tmpfs may take: tmpfs pages count
 * against the same limit, and the rest leaves room for V8's young generation, code and native memory.
 */
const MEMORY_MAX_SHARE = 0.8;

/** Namespaces a service must never share with the host. */
const HOST_NAMESPACES = ["network_mode", "pid", "ipc"];

/**
 * Parses a Compose file as Compose does: YAML 1.2 with merge keys (`<<: *a` or `<<: [*a, *b]`,
 * explicit keys win, the first merged map wins over the next).
 * @param source the file's text.
 * @returns the document as plain objects, arrays and scalars.
 * @throws YAMLParseError on invalid YAML, an unknown alias or a duplicate key.
 */
export function parseComposeYaml(source) {
  return parse(source, { merge: true }) ?? {};
}

/**
 * Checks a parsed Compose document against the hardening rules.
 * @param document the parsed file (`parseComposeYaml`).
 * @param path the file's path, for the messages.
 * @returns the problems found; empty when every service follows the rules.
 */
export function checkComposeHardening(document, path = COMPOSE_IMAGES) {
  const services = document?.services;
  if (!services || typeof services !== "object" || Object.keys(services).length === 0) {
    return [`${path}: no services`];
  }
  const problems = [];
  const migrateOf = new Map(
    Object.entries(services)
      .filter(([, service]) => isOneOff(service))
      .map(([name, service]) => [service.image, name]),
  );
  for (const [name, service] of Object.entries(services)) {
    const at = `${path}: ${name}`;
    if (service.read_only !== true) problems.push(`${at} must set read_only: true`);
    if (!asList(service.cap_drop).includes("ALL"))
      problems.push(`${at} must drop every capability (cap_drop: [ALL])`);
    if (
      !asList(service.security_opt).some((opt) => /^no-new-privileges(:true|=true)?$/.test(opt))
    ) {
      problems.push(`${at} must set security_opt no-new-privileges:true`);
    }
    if (!asList(service.tmpfs).some((mount) => /^\/tmp:(.*,)?size=\d+[kmg]?(,|$)/.test(mount))) {
      problems.push(`${at} must mount a size-capped tmpfs on /tmp`);
    }
    problems.push(...privilegeProblems(service, at));
    const tmpfs = tmpfsMegabytes(service.tmpfs);
    if (tmpfs === null) problems.push(`${at} must cap every tmpfs with size=`);
    const limit = megabytes(service.mem_limit);
    if (limit === null) problems.push(`${at} must set mem_limit (ADR-027)`);
    for (const port of asList(service.ports)) {
      if (!String(port).startsWith("127.0.0.1:"))
        problems.push(`${at} publishes ${port}: bind it to 127.0.0.1 (ADR-027)`);
    }
    if (/-migrate$/.test(name) && !isOneOff(service)) {
      problems.push(`${at} is a one-off: set restart: "no" and disable its healthcheck`);
    }
    if (isOneOff(service)) continue;
    const heap = maxOldSpace(service.environment?.NODE_OPTIONS);
    if (limit !== null && (heap === null || heap < limit * HEAP_MIN_SHARE)) {
      problems.push(
        `${at} must set NODE_OPTIONS --max-old-space-size to at least 60% of mem_limit`,
      );
    } else if (limit !== null && tmpfs !== null && heap + tmpfs > limit * MEMORY_MAX_SHARE) {
      problems.push(
        `${at} heap ${heap} MB plus tmpfs ${tmpfs} MB exceeds 80% of mem_limit (${limit * MEMORY_MAX_SHARE} MB)`,
      );
    }
    const migrate = migrateOf.get(service.image);
    if (migrate && service.depends_on?.[migrate]?.condition !== "service_completed_successfully") {
      problems.push(
        `${at} must depend on ${migrate} with condition: service_completed_successfully`,
      );
    }
  }
  return problems;
}

/**
 * Reads the repository's runtime Compose file and checks it.
 * @param root the repository root.
 * @returns the services checked and the problems found.
 */
export function checkRepository(root = REPO_ROOT) {
  const document = parseComposeYaml(readFileSync(join(root, COMPOSE_IMAGES), "utf8"));
  return {
    services: Object.keys(document.services ?? {}).sort(),
    problems: checkComposeHardening(document),
  };
}

/**
 * The privileges a service must not take back (D4): each one undoes a hardening layer or hands the
 * container the host (the Docker socket is root on the host).
 * @param service one parsed Compose service.
 * @param at the message prefix.
 * @returns the problems found.
 */
function privilegeProblems(service, at) {
  const problems = [];
  if (service.privileged === true) problems.push(`${at} must not set privileged: true`);
  if (asList(service.cap_add).length > 0)
    problems.push(`${at} must not add capabilities (cap_add)`);
  if (/^(root|0)(:|$)/.test(String(service.user ?? "").trim())) {
    problems.push(`${at} must not run as root (user: ${service.user})`);
  }
  for (const key of HOST_NAMESPACES) {
    if (service[key] === "host") problems.push(`${at} must not set ${key}: host`);
  }
  for (const volume of Array.isArray(service.volumes) ? service.volumes : []) {
    const source = typeof volume === "string" ? volume.split(":")[0] : volume?.source;
    if (/docker\.sock$/.test(String(source ?? ""))) {
      problems.push(`${at} must not mount the Docker socket`);
    }
  }
  return problems;
}

/**
 * The sum of a service's tmpfs `size=` values in megabytes; null when one has no size (an uncapped
 * tmpfs can grow to half the host's memory).
 */
function tmpfsMegabytes(tmpfs) {
  let total = 0;
  for (const mount of asList(tmpfs)) {
    const size = /(?:^|[:,])size=(\d+[bkmg]?)(?:,|$)/i.exec(mount);
    const value = size ? megabytes(size[1]) : null;
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** A one-off process: never restarted and without a healthcheck (D5, WP-10 D2). */
function isOneOff(service) {
  return service.restart === "no" && service.healthcheck?.disable === true;
}

/** A Compose memory size (`300m`, `1g`, bytes) in megabytes, or null when missing or unreadable. */
function megabytes(value) {
  const match = /^(\d+)([bkmg]?)$/i.exec(String(value ?? ""));
  if (!match) return null;
  const scale = { "": 1 / 2 ** 20, b: 1 / 2 ** 20, k: 1 / 1024, m: 1, g: 1024 };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

/** The `--max-old-space-size` of a NODE_OPTIONS value, in megabytes, or null. */
function maxOldSpace(nodeOptions) {
  const match = /--max-old-space-size=(\d+)/.exec(String(nodeOptions ?? ""));
  return match ? Number(match[1]) : null;
}

function asList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
