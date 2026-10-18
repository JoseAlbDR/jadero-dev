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
 * `compose.dev.yml` (`imageParityProblems`), so dev runs what the server runs. Every ops service
 * rotates its logs; Postgres and RabbitMQ get time to shut down cleanly, and the broker stays off
 * the ops network. `pgHbaProblems` ties `infra/postgres/pg_hba.conf` to the networks: each role is
 * accepted only from its environment's subnet, and every subnet the file names is a network
 * Postgres joins (the WP-8 mid-WP review).
 *
 * The servers' service projects, `infra/compose/compose.services.yml` with `compose.staging.yml`
 * and `compose.prod.yml` (WP-9 step 2; ADR-053, ADR-051 restating ADR-027), keep the runtime rules
 * above and add their own (`checkServicesHardening`, `checkEnvironmentOverlay`): every image is a
 * required variable from `versions.env` (a digest reference, never a tag, never a build), every
 * process type reads its service's rendered env file and blanks the credentials it does not use,
 * nothing is published by the shared file, an overlay holds only its project name, the ports of
 * `api` and `web` on 127.0.0.1 and its environment's network as external, and each process type
 * gets every variable its config requires. `envTemplateProblems` holds `infra/env/<service>.env.tpl`
 * to 1Password references for every secret, each an item `ops.env.tpl` also provisions.
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

/** Postgres's client authentication file on the servers, relative to the root. */
export const PG_HBA = "infra/postgres/pg_hba.conf";

/** The services of both server environments, relative to the root. */
export const COMPOSE_SERVICES = "infra/compose/compose.services.yml";

/** The template of the ops stack's secrets, whose items the service templates reuse. */
export const OPS_ENV_TEMPLATE = "infra/env/ops.env.tpl";

/** The env template of a service, relative to the root. */
export const envTemplatePath = (service) => `infra/env/${service}.env.tpl`;

/**
 * The two server environments (ADR-051 restating ADR-027 "Layout"; WP-9 implementation choices):
 * the overlay file, the Compose project, the ops network it joins as external, and the only ports
 * it publishes (staging's are what nginx proxies for new.jadero.dev today).
 */
export const ENVIRONMENTS = {
  staging: {
    file: "infra/compose/compose.staging.yml",
    project: "jadero-staging",
    network: "jadero_staging",
    ports: { api: "127.0.0.1:3121:3001", web: "127.0.0.1:3120:3000" },
  },
  prod: {
    file: "infra/compose/compose.prod.yml",
    project: "jadero-prod",
    network: "jadero_prod",
    ports: { api: "127.0.0.1:3111:3001", web: "127.0.0.1:3110:3000" },
  },
};

/**
 * The credentials each process type reads (its config schema in `apps/<service>/src/config`); every
 * other secret of its service's template must be blanked in its `environment`. A process type
 * missing here is a problem, so a new one states what it may hold.
 */
const PROCESS_SECRETS = {
  api: ["DATABASE_URL", "DATABASE_READ_URL"],
  "api-worker": ["DATABASE_URL", "RABBITMQ_URL"],
  "api-migrate": ["DATABASE_URL"],
  agent: ["DATABASE_URL"],
  "agent-consumer": ["DATABASE_URL", "RABBITMQ_URL"],
  "agent-migrate": ["DATABASE_URL"],
  web: [],
};

/**
 * The variables each process type needs with no default in its config schema (`apiEnv`,
 * `apiWorkerEnv`, `agentEnv`, `agentConsumerEnv`, `telemetryEnv`, the migrate entries' `pick`,
 * web's `contentApiUrl`), plus the ones whose default is wrong on a server (`SITE_URL`).
 */
const REQUIRED_VARIABLES = {
  api: ["PORT", "DATABASE_URL", "DATABASE_READ_URL", "OTEL_SERVICE_NAME"],
  "api-worker": ["PORT", "DATABASE_URL", "RABBITMQ_URL", "OTEL_SERVICE_NAME"],
  "api-migrate": ["DATABASE_URL"],
  agent: ["PORT", "DATABASE_URL", "OTEL_SERVICE_NAME"],
  "agent-consumer": ["PORT", "DATABASE_URL", "RABBITMQ_URL", "OTEL_SERVICE_NAME"],
  "agent-migrate": ["DATABASE_URL"],
  web: ["CONTENT_API_URL", "SITE_URL"],
};

/**
 * Plain values each template must hold on the servers (WP-9 implementation choices): production
 * mode, info logs, no span exporter until a collector runs there, a one-minute heartbeat, fake AI
 * providers (AGENTS.md section 7), the enforced CSP (ADR-047).
 */
const TEMPLATE_VALUES = {
  api: {
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    OTEL_TRACES_EXPORTER: "none",
    HEARTBEAT_INTERVAL_MS: "60000",
  },
  agent: {
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    OTEL_TRACES_EXPORTER: "none",
    AI_CHAT_PROVIDER: "fake",
    AI_GUARD_PROVIDER: "fake",
    AI_EMBEDDINGS_PROVIDER: "fake",
    AI_RERANK_PROVIDER: "fake",
  },
  web: { NODE_ENV: "production", CSP_MODE: "enforce" },
};

/** The only variables an overlay may set in a service's `environment`: never a secret. */
const OVERLAY_ENVIRONMENT = ["SITE_URL"];

/** A 1Password reference in a service template: an item of the environment, its password field. */
const SERVICE_REFERENCE = /\{\{ op:\/\/jadero-ops\/([a-z0-9-]+)-\$JADERO_ENV\/password \}\}/g;

/** The required image variable of a service (`${API_IMAGE:?...}`), filled from versions.env. */
const IMAGE_VARIABLE = /^\$\{([A-Z]+)_IMAGE:\?[^}]+\}$/;

/** The rendered env file of a service, in the environment's folder (`JADERO_ENV` required). */
const ENV_FILE_PATH = /^\/srv\/jadero\/\$\{JADERO_ENV:\?[^}]+\}\/([a-z]+)\.env$/;

/** The services of the ops stack that must run the same image as in dev. */
const DEV_PARITY_SERVICES = ["postgres", "rabbitmq"];

/**
 * The ops services that hold data on disk and need longer than Docker's default 10 seconds to
 * stop cleanly (a Postgres checkpoint, RabbitMQ's message store), with the least grace in seconds.
 */
const STOP_GRACE_SECONDS = { postgres: 60, rabbitmq: 60 };

/** Networks an ops service must not join: nothing on `jadero_ops` speaks AMQP (ADR-050). */
const NETWORK_BANS = { rabbitmq: ["jadero_ops"] };

/**
 * The network each Postgres role may connect from, by its name (WP-8 D4): `<service>_prod` from
 * production's, `<service>_staging` from staging's, `umami` from the ops network.
 */
const ROLE_NETWORKS = [
  [/_prod$/, "jadero_prod"],
  [/_staging$/, "jadero_staging"],
  [/^umami$/, "jadero_ops"],
];

/** The only password method pg_hba.conf may accept a role with (ADR-050). */
const PG_HBA_METHOD = "scram-sha-256";

/** The pg_hba.conf connection types that come over TCP and so carry an address. */
const PG_HBA_TCP_TYPES = ["host", "hostssl", "hostnossl", "hostgssenc", "hostnogssenc"];

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
    if (
      service.logging?.driver !== "local" ||
      !service.logging?.options?.["max-size"] ||
      !service.logging?.options?.["max-file"]
    ) {
      problems.push(`${at} must rotate its logs (logging: driver local, max-size and max-file)`);
    }
    const grace = STOP_GRACE_SECONDS[name];
    if (grace !== undefined && !(seconds(service.stop_grace_period) >= grace)) {
      problems.push(`${at} must set stop_grace_period to at least ${grace}s`);
    }
    for (const network of NETWORK_BANS[name] ?? []) {
      if (serviceNetworks(service).includes(network)) {
        problems.push(`${at} must not join ${network}`);
      }
    }
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
 * Parses a pg_hba.conf into its rule lines: comments and blank lines dropped, fields split on
 * whitespace. Enough for this file's own syntax; no quoted fields, includes or `@file` lists.
 * @param source the file's text.
 * @returns one entry per rule: its line number, type, databases, users, address (TCP types
 *   only, else null) and method.
 */
export function parsePgHba(source) {
  const entries = [];
  source.split("\n").forEach((text, index) => {
    const fields = text.replace(/#.*$/, "").trim().split(/\s+/).filter(Boolean);
    if (fields.length === 0) return;
    const [type, databases = "", users = ""] = fields;
    const tcp = PG_HBA_TCP_TYPES.includes(type);
    entries.push({
      line: index + 1,
      type,
      databases: databases.split(","),
      users: users.split(","),
      address: tcp ? (fields[3] ?? null) : null,
      method: fields[tcp ? 4 : 3] ?? null,
    });
  });
  return entries;
}

/**
 * Checks pg_hba.conf against the ops stack's networks (ADR-050, Q1's compensating controls): every
 * TCP line that lets a role in names a CIDR subnet of a network Postgres joins, uses
 * scram-sha-256, and names only roles whose environment's network has exactly that subnet. Reject
 * lines are not checked: they let nobody in.
 * @param entries the parsed file (`parsePgHba`).
 * @param ops the parsed `compose.ops.yml`.
 * @param path the file's path, for the messages.
 * @returns the problems found; empty when every line matches its network.
 */
export function pgHbaProblems(entries, ops, path = PG_HBA) {
  const subnets = new Map(
    Object.entries(ops?.networks ?? {}).map(([name, network]) => [
      name,
      (network?.ipam?.config ?? []).map((config) => config?.subnet).filter(Boolean),
    ]),
  );
  const postgresNetworks = serviceNetworks(ops?.services?.postgres ?? {});
  const problems = [];
  for (const entry of entries) {
    if (!PG_HBA_TCP_TYPES.includes(entry.type) || entry.method === "reject") continue;
    const at = `${path}:${entry.line}`;
    if (!/^[0-9a-f.:]+\/\d+$/i.test(String(entry.address ?? ""))) {
      problems.push(`${at} accepts ${entry.address ?? "no address"}: name a CIDR subnet`);
      continue;
    }
    if (entry.method !== PG_HBA_METHOD) {
      problems.push(`${at} uses ${entry.method}: use ${PG_HBA_METHOD}`);
    }
    const network = [...subnets].find(([, list]) => list.includes(entry.address))?.[0];
    if (network === undefined) {
      problems.push(`${at} names ${entry.address}, the subnet of no network in ${COMPOSE_OPS}`);
    } else if (!postgresNetworks.includes(network)) {
      problems.push(`${at} names ${network}, a network postgres does not join`);
    }
    for (const role of entry.users) {
      const expected = ROLE_NETWORKS.find(([pattern]) => pattern.test(role))?.[1];
      if (expected === undefined) {
        problems.push(`${at} accepts role ${role}, which belongs to no environment's network`);
      } else if (!(subnets.get(expected) ?? []).includes(entry.address)) {
        problems.push(
          `${at} accepts role ${role} from ${entry.address}, but its network ${expected} is ${(subnets.get(expected) ?? []).join(", ") || "not defined"}`,
        );
      }
    }
  }
  return problems;
}

/**
 * Reads the repository's ops and dev Compose files and pg_hba.conf, and checks the ops stack.
 * @param root the repository root.
 * @returns the services checked and the problems found.
 */
export function checkOpsRepository(root = REPO_ROOT) {
  const ops = parseComposeYaml(readFileSync(join(root, COMPOSE_OPS), "utf8"));
  const dev = parseComposeYaml(readFileSync(join(root, COMPOSE_DEV), "utf8"));
  const hba = parsePgHba(readFileSync(join(root, PG_HBA), "utf8"));
  return {
    services: Object.keys(ops.services ?? {}).sort(),
    problems: [
      ...checkOpsHardening(ops),
      ...imageParityProblems(dev, ops),
      ...pgHbaProblems(hba, ops),
    ],
  };
}

/**
 * Parses an env template (`KEY=value` lines, `#` comments) the way Compose reads an env file.
 * @param source the template's text.
 * @returns the comment lines and the entries, each with its line number.
 */
export function parseEnvTemplate(source) {
  const comments = [];
  const entries = [];
  source.split("\n").forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(#|$)/.test(text)) {
      if (text.trim() !== "") comments.push({ line, text });
      return;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(text);
    entries.push(
      match ? { line, name: match[1], value: match[2] } : { line, name: null, value: text },
    );
  });
  return { comments, entries };
}

/**
 * The names of the template's variables whose value holds a 1Password reference.
 * @param template the parsed template (`parseEnvTemplate`).
 * @returns the secret variables' names.
 */
export function secretVariables(template) {
  return template.entries.filter((e) => e.value.includes("{{")).map((e) => e.name);
}

/**
 * Checks a service's env template (ADR-043, WP-9 step 2): every secret is a 1Password reference to
 * the environment's item (`<item>-$JADERO_ENV`, its `password` field) that `ops.env.tpl` also
 * provisions for both environments, so a rotation changes one item; no comment holds a reference
 * (`op inject` resolves those too); no value carries a literal credential; the only interpolation
 * outside a reference is `${JADERO_ENV}` (Compose resolves any other `$` from the deploy's shell);
 * and the plain server values are set.
 * @param template the parsed template (`parseEnvTemplate`).
 * @param service the service it belongs to (`api`, `agent`, `web`).
 * @param opsTemplate the text of `ops.env.tpl`.
 * @param path the template's path, for the messages.
 * @returns the problems found; empty when the template follows the rules.
 */
export function envTemplateProblems(
  template,
  service,
  opsTemplate,
  path = envTemplatePath(service),
) {
  const problems = [];
  for (const { line, text } of template.comments) {
    if (/op:\/\/|\{\{/.test(text)) {
      problems.push(`${path}:${line} holds a secret reference in a comment: op inject resolves it`);
    }
  }
  const values = new Map();
  for (const { line, name, value } of template.entries) {
    const at = `${path}:${line}`;
    if (name === null) {
      problems.push(`${at} is not a KEY=value line`);
      continue;
    }
    values.set(name, value);
    const references = [...value.matchAll(SERVICE_REFERENCE)];
    const rest = value.replace(SERVICE_REFERENCE, "");
    if (/op:\/\/|\{\{|\}\}/.test(rest)) {
      problems.push(
        `${at} ${name}: every reference must read {{ op://jadero-ops/<item>-$JADERO_ENV/password }}`,
      );
    }
    for (const [, item] of references) {
      for (const env of Object.keys(ENVIRONMENTS)) {
        if (!opsTemplate.includes(`op://jadero-ops/${item}-${env}/password`)) {
          problems.push(`${at} ${name}: item ${item}-${env} is not in ${OPS_ENV_TEMPLATE}`);
        }
      }
    }
    if (/\$(?!\{JADERO_ENV\})/.test(rest)) {
      problems.push(`${at} ${name}: only \${JADERO_ENV} may be interpolated outside a reference`);
    }
    if (/:\/\/[^/@\s]*:[^/@\s]+@/.test(rest)) {
      problems.push(`${at} ${name} carries a credential in clear: use a 1Password reference`);
    }
    if (/(PASSWORD|SECRET|TOKEN|_KEY)$/.test(name) && references.length === 0) {
      problems.push(`${at} ${name} looks like a secret: use a 1Password reference`);
    }
  }
  for (const [name, expected] of Object.entries(TEMPLATE_VALUES[service] ?? {})) {
    if (values.get(name) !== expected) {
      problems.push(`${path}: ${name} must be ${expected} on the servers`);
    }
  }
  return problems;
}

/**
 * Checks the servers' shared services file (WP-9 step 2) on top of the runtime rules of
 * `checkComposeHardening`: each image is its service's required variable, never a build; each
 * process type reads its service's rendered env file, blanks every secret it does not read and
 * keeps the ones it does; nothing is published here (the overlays do) and no network is named;
 * logs rotate; a long-running process restarts and depends only on its own migrate step.
 * @param document the parsed `compose.services.yml`.
 * @param templates the parsed env template of each service, by service name.
 * @param path the file's path, for the messages.
 * @returns the problems found; empty when every process type follows the rules.
 */
export function checkServicesHardening(document, templates, path = COMPOSE_SERVICES) {
  const problems = checkComposeHardening(document, path);
  for (const [name, service] of Object.entries(document?.services ?? {})) {
    const at = `${path}: ${name}`;
    const owner = name.split("-")[0];
    const image = IMAGE_VARIABLE.exec(String(service.image ?? ""));
    if (!image || image[1] !== owner.toUpperCase()) {
      problems.push(
        `${at} must run \${${owner.toUpperCase()}_IMAGE:?...} from versions.env (a digest reference)`,
      );
    }
    if (service.build !== undefined) problems.push(`${at} must not build: servers pull by digest`);
    if (service.ports !== undefined) {
      problems.push(`${at} must not publish ports here: the environment overlays do`);
    }
    if (service.networks !== undefined || service.network_mode !== undefined) {
      problems.push(`${at} must stay on the default network, which each overlay names`);
    }
    if (
      service.logging?.driver !== "local" ||
      !service.logging?.options?.["max-size"] ||
      !service.logging?.options?.["max-file"]
    ) {
      problems.push(`${at} must rotate its logs (logging: driver local, max-size and max-file)`);
    }
    const envFiles = Array.isArray(service.env_file) ? service.env_file : [service.env_file];
    const envFile = envFiles.length === 1 ? envFiles[0] : undefined;
    const envPath = typeof envFile === "string" ? envFile : envFile?.path;
    const file = ENV_FILE_PATH.exec(String(envPath ?? ""));
    if (!file || file[1] !== owner || envFile?.required === false) {
      problems.push(
        `${at} must read only /srv/jadero/\${JADERO_ENV:?...}/${owner}.env, required (env_file)`,
      );
    }
    if (!isOneOff(service)) {
      if (service.restart !== "unless-stopped") {
        problems.push(`${at} must set restart: unless-stopped`);
      }
      for (const dependency of Object.keys(service.depends_on ?? {})) {
        if (dependency !== `${owner}-migrate`) {
          problems.push(`${at} must not depend on ${dependency}: only on its own migrate step`);
        }
      }
    }
    const allowed = PROCESS_SECRETS[name];
    if (allowed === undefined) {
      problems.push(`${at} is a process type with no credential list: add it to PROCESS_SECRETS`);
      continue;
    }
    const environment = service.environment ?? {};
    for (const secret of secretVariables(templates[owner] ?? { entries: [] })) {
      const blanked = Object.hasOwn(environment, secret) && environment[secret] === "";
      if (!allowed.includes(secret) && !blanked) {
        problems.push(
          `${at} must blank ${secret} (environment: ${secret}: ""): it does not read it`,
        );
      } else if (allowed.includes(secret) && Object.hasOwn(environment, secret)) {
        problems.push(`${at} must take ${secret} from its env file, not override it`);
      }
    }
  }
  return problems;
}

/**
 * Checks one environment's overlay (WP-9 step 2, ADR-051): its project name; only `api` and `web`
 * publish, each exactly its port on 127.0.0.1; a service sets nothing but `ports` and the allowed
 * non-secret variables; the only network is the default one, as the external ops network of the
 * environment.
 * @param document the parsed overlay.
 * @param env the environment (`staging`, `prod`).
 * @param services the parsed `compose.services.yml`.
 * @param ops the parsed `compose.ops.yml`.
 * @returns the problems found; empty when the overlay follows the rules.
 */
export function checkEnvironmentOverlay(document, env, services, ops) {
  const { file, project, network, ports } = ENVIRONMENTS[env];
  const problems = [];
  if (document?.name !== project) problems.push(`${file} must name the project ${project}`);
  for (const key of Object.keys(document ?? {})) {
    if (!["name", "services", "networks"].includes(key) && !key.startsWith("x-")) {
      problems.push(`${file} must hold only name, services and networks (found ${key})`);
    }
  }
  const networks = document?.networks ?? {};
  const opsNetwork = Object.values(ops?.networks ?? {}).some((n) => n?.name === network);
  if (
    Object.keys(networks).join() !== "default" ||
    networks.default?.name !== network ||
    networks.default?.external !== true
  ) {
    problems.push(`${file} must join only ${network}, as the external default network`);
  } else if (!opsNetwork) {
    problems.push(`${file} joins ${network}, which ${COMPOSE_OPS} does not create`);
  }
  for (const [name, service] of Object.entries(document?.services ?? {})) {
    const at = `${file}: ${name}`;
    if (!services?.services?.[name]) problems.push(`${at} is not a service of ${COMPOSE_SERVICES}`);
    for (const key of Object.keys(service ?? {})) {
      if (!["ports", "environment"].includes(key)) {
        problems.push(`${at} must set only ports and environment (found ${key})`);
      }
    }
    for (const variable of Object.keys(service?.environment ?? {})) {
      if (!OVERLAY_ENVIRONMENT.includes(variable)) {
        problems.push(`${at} must not set ${variable}: it belongs in the env template`);
      }
    }
    const published = (service?.ports ?? []).map((port) => parsePort(port));
    const expected = ports[name];
    if (published.length > 0 && expected === undefined) {
      problems.push(`${at} publishes a port: only ${Object.keys(ports).join(" and ")} do`);
    }
    for (const port of published) {
      if (port.hostIp !== "127.0.0.1") {
        problems.push(`${at} publishes ${port.text}: bind it to 127.0.0.1 (ADR-027)`);
      }
    }
    if (expected !== undefined && published.map((p) => p.text).join() !== expected) {
      problems.push(`${at} must publish exactly ${expected}`);
    }
  }
  for (const [name, port] of Object.entries(ports)) {
    if (!document?.services?.[name]?.ports) problems.push(`${file}: ${name} must publish ${port}`);
  }
  return problems;
}

/**
 * Checks that every process type of one environment gets each variable its config requires, from
 * its env template (unless blanked), its own `environment` or the overlay's.
 * @param services the parsed `compose.services.yml`.
 * @param overlay the parsed overlay of the environment.
 * @param templates the parsed env template of each service, by service name.
 * @param file the overlay's path, for the messages.
 * @returns the problems found; empty when nothing is missing.
 */
export function missingVariableProblems(services, overlay, templates, file) {
  const problems = [];
  for (const [name, service] of Object.entries(services?.services ?? {})) {
    const owner = name.split("-")[0];
    const environment = {
      ...Object.fromEntries((templates[owner]?.entries ?? []).map((e) => [e.name, e.value])),
      ...(service.environment ?? {}),
      ...(overlay?.services?.[name]?.environment ?? {}),
    };
    for (const variable of REQUIRED_VARIABLES[name] ?? []) {
      if (!environment[variable]) {
        problems.push(`${file}: ${name} gets no ${variable}, which its config requires`);
      }
    }
  }
  return problems;
}

/**
 * Reads the servers' services file, both overlays, the env templates and the ops stack, and checks
 * them together.
 * @param root the repository root.
 * @returns the process types checked and the problems found.
 */
export function checkServicesRepository(root = REPO_ROOT) {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const services = parseComposeYaml(read(COMPOSE_SERVICES));
  const ops = parseComposeYaml(read(COMPOSE_OPS));
  const opsTemplate = read(OPS_ENV_TEMPLATE);
  const owners = [...new Set(Object.keys(services.services ?? {}).map((n) => n.split("-")[0]))];
  const templates = Object.fromEntries(
    owners.map((owner) => [owner, parseEnvTemplate(read(envTemplatePath(owner)))]),
  );
  const problems = [
    ...owners.flatMap((owner) => envTemplateProblems(templates[owner], owner, opsTemplate)),
    ...checkServicesHardening(services, templates),
  ];
  for (const [env, { file }] of Object.entries(ENVIRONMENTS)) {
    const overlay = parseComposeYaml(read(file));
    problems.push(...checkEnvironmentOverlay(overlay, env, services, ops));
    problems.push(...missingVariableProblems(services, overlay, templates, file));
  }
  return { services: Object.keys(services.services ?? {}).sort(), problems };
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

/** The networks a Compose service joins, from the list or the map form of `networks`. */
function serviceNetworks(service) {
  const networks = service?.networks;
  if (Array.isArray(networks)) return networks.map(String);
  return networks && typeof networks === "object" ? Object.keys(networks) : [];
}

/**
 * A Compose duration (`60s`, `1m30s`, `1h`, a bare number of seconds) in seconds, or NaN when
 * missing or unreadable.
 */
function seconds(value) {
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^(\d+(\.\d+)?(h|ms|m|s|us|ns))+$/.test(text)) return Number.NaN;
  const scale = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9 };
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s|us|ns)/g)) {
    total += Number(amount) * scale[unit];
  }
  return total;
}

/** The `--max-old-space-size` of a NODE_OPTIONS value, in megabytes, or null. */
function maxOldSpace(nodeOptions) {
  const match = /--max-old-space-size=(\d+)/.exec(String(nodeOptions ?? ""));
  return match ? Number(match[1]) : null;
}

function asList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
