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
 * The server's ops stack, `infra/compose/compose.ops.yml` (WP-8 step 4; ADR-050 restating ADR-027,
 * Q1's compensating controls), runs third-party images that cannot all be read-only or capability
 * free, so it has its own rules (`checkOpsHardening`): every image pinned by digest, a memory limit,
 * no new privileges, a healthcheck, ports on 127.0.0.1 only and never a database, broker or Erlang
 * port, and the same privilege bans. Its Postgres and RabbitMQ use exactly the images of
 * `compose.dev.yml` (`imageParityProblems`), so dev runs what the server runs.
 *
 * Run by `scripts/compose-hardening.test.mjs` through `pnpm test:scripts`, so `pnpm verify`. The
 * files are read with the `yaml` package, merge keys on (`<<: *hardened`), as Compose reads them.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The Compose file that runs the production images, relative to the root. */
export const COMPOSE_IMAGES = "infra/compose/compose.images.yml";

/** The server's ops stack, relative to the root. */
export const COMPOSE_OPS = "infra/compose/compose.ops.yml";

/** The dev dependencies, relative to the root. */
export const COMPOSE_DEV = "infra/compose/compose.dev.yml";

/** The services of the ops stack that must run the same image as in dev. */
const DEV_PARITY_SERVICES = ["postgres", "rabbitmq"];

/**
 * Container ports the ops stack never publishes, even on 127.0.0.1 (ADR-050: no published database
 * or broker port): Postgres, AMQP and AMQPS, and Erlang's port mapper and distribution port, which
 * with the cookie give a shell on the broker.
 */
const UNPUBLISHED_PORTS = [5432, 5672, 5671, 4369, 25672];

/** An image reference pinned by its digest (`name:tag@sha256:<64 hex>`). */
const PINNED_IMAGE = /@sha256:[0-9a-f]{64}$/;

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
 * Checks the server's ops stack against its rules (WP-8 step 4, ADR-050).
 * @param document the parsed file (`parseComposeYaml`).
 * @param path the file's path, for the messages.
 * @returns the problems found; empty when every service follows the rules.
 */
export function checkOpsHardening(document, path = COMPOSE_OPS) {
  const services = document?.services;
  if (!services || typeof services !== "object" || Object.keys(services).length === 0) {
    return [`${path}: no services`];
  }
  const problems = [];
  for (const [name, service] of Object.entries(services)) {
    const at = `${path}: ${name}`;
    if (!PINNED_IMAGE.test(String(service.image ?? ""))) {
      problems.push(`${at} must pin its image by digest (image: name:tag@sha256:...)`);
    }
    if (megabytes(service.mem_limit) === null) problems.push(`${at} must set mem_limit (ADR-027)`);
    if (
      !asList(service.security_opt).some((opt) => /^no-new-privileges(:true|=true)?$/.test(opt))
    ) {
      problems.push(`${at} must set security_opt no-new-privileges:true`);
    }
    if (!service.healthcheck?.test || service.healthcheck.disable === true) {
      problems.push(`${at} must define a healthcheck`);
    }
    problems.push(...privilegeProblems(service, at));
    for (const port of Array.isArray(service.ports) ? service.ports : []) {
      const { hostIp, target, published, text } = parsePort(port);
      if (hostIp !== "127.0.0.1") {
        problems.push(`${at} publishes ${text}: bind it to 127.0.0.1 (ADR-027)`);
      }
      const forbidden = UNPUBLISHED_PORTS.find((p) => inRange(target, p) || inRange(published, p));
      if (forbidden !== undefined) {
        problems.push(`${at} publishes ${text}: port ${forbidden} is never published (ADR-050)`);
      }
    }
  }
  return problems;
}

/**
 * Checks that the ops stack's Postgres and RabbitMQ run exactly the dev images (tag and digest).
 * @param dev the parsed `compose.dev.yml`.
 * @param ops the parsed `compose.ops.yml`.
 * @returns the problems found; empty when both match.
 */
export function imageParityProblems(dev, ops) {
  const problems = [];
  for (const name of DEV_PARITY_SERVICES) {
    const devImage = dev?.services?.[name]?.image;
    const opsImage = ops?.services?.[name]?.image;
    if (!devImage || devImage !== opsImage) {
      problems.push(
        `${COMPOSE_OPS}: ${name} runs ${opsImage ?? "nothing"}, but ${COMPOSE_DEV} runs ${devImage ?? "nothing"}: keep them equal`,
      );
    }
  }
  return problems;
}

/**
 * Reads the repository's ops and dev Compose files and checks the ops stack.
 * @param root the repository root.
 * @returns the services checked and the problems found.
 */
export function checkOpsRepository(root = REPO_ROOT) {
  const ops = parseComposeYaml(readFileSync(join(root, COMPOSE_OPS), "utf8"));
  const dev = parseComposeYaml(readFileSync(join(root, COMPOSE_DEV), "utf8"));
  return {
    services: Object.keys(ops.services ?? {}).sort(),
    problems: [...checkOpsHardening(ops), ...imageParityProblems(dev, ops)],
  };
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
 * Reads one entry of a service's `ports`, short syntax (`[ip:][host:]container[/proto]`, each port
 * maybe a range `a-b`) or long (`{ target, published, host_ip }`). No host IP means every interface.
 * @param port the entry as parsed.
 * @returns the host IP (or null), the container and host port ranges as `[first, last]` (null
 *   when absent), and the entry as text for the messages.
 */
function parsePort(port) {
  if (port && typeof port === "object") {
    return {
      hostIp: port.host_ip ?? null,
      target: portRange(port.target),
      published: portRange(port.published),
      text: JSON.stringify(port),
    };
  }
  const text = String(port);
  const parts = text.replace(/\/(tcp|udp)$/, "").split(":");
  return {
    hostIp:
      parts.length >= 3
        ? parts
            .slice(0, -2)
            .join(":")
            .replace(/^\[|\]$/g, "")
        : null,
    target: portRange(parts.at(-1)),
    published: parts.length >= 2 ? portRange(parts.at(-2)) : null,
    text,
  };
}

/** A port or port range (`5672`, `"5670-5680"`) as `[first, last]`, or null. */
function portRange(value) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? match[1])];
}

/** Whether a port lies in a range from `portRange`. */
function inRange(range, port) {
  return range !== null && range[0] <= port && port <= range[1];
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
