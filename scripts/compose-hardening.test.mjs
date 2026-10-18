// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkComposeHardening,
  checkEnvironmentOverlay,
  checkOpsHardening,
  checkOpsRepository,
  checkRepository,
  checkServicesHardening,
  checkServicesRepository,
  envTemplateProblems,
  imageParityProblems,
  missingVariableProblems,
  parseComposeYaml,
  parseEnvTemplate,
  parsePgHba,
  pgHbaProblems,
} from "./compose-hardening.mjs";

const HARDENED = `
x-hardened: &hardened
  read_only: true
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  tmpfs: ["/tmp:size=16m"]
x-migrate: &migrate
  restart: "no"
  healthcheck:
    disable: true
`;

/** A small runtime Compose file: one migrate and one server of the same image. */
const compose = (server, migrate = "") => `${HARDENED}
services:
  app-migrate:
    <<: [*hardened, *migrate]
    image: app:dev
    mem_limit: 300m${migrate}
  app:
    <<: *hardened
    image: app:dev
    restart: unless-stopped
    environment:
      NODE_OPTIONS: --max-old-space-size=224
    ports:
      - "127.0.0.1:3001:3001"
    mem_limit: 300m
    depends_on:
      app-migrate:
        condition: service_completed_successfully${server}
`;

const check = (source) => checkComposeHardening(parseComposeYaml(source), "compose.yml");

describe("the repository's compose.images.yml", () => {
  it("runs every service hardened, limited and after its migrate step", () => {
    const { services, problems } = checkRepository();
    assert.deepEqual(services, [
      "agent",
      "agent-consumer",
      "agent-migrate",
      "api",
      "api-migrate",
      "api-worker",
      "web",
    ]);
    assert.deepEqual(problems, []);
  });
});

describe("checkComposeHardening", () => {
  it("accepts services that carry the anchor, a limit and the migrate dependency", () => {
    assert.deepEqual(check(compose("")), []);
  });

  it("fails when an explicit key overrides the anchor", () => {
    assert.deepEqual(check(compose("\n    read_only: false")), [
      "compose.yml: app must set read_only: true",
    ]);
  });

  it("fails when a service's own tmpfs list drops /tmp (the merge is shallow)", () => {
    assert.deepEqual(check(compose('\n    tmpfs: ["/cache:size=8m"]')), [
      "compose.yml: app must mount a size-capped tmpfs on /tmp",
    ]);
  });

  it("fails when a service lacks the anchor entirely", () => {
    const source = `${HARDENED}
services:
  bare:
    image: bare:dev
    restart: unless-stopped
    mem_limit: 128m
    environment:
      NODE_OPTIONS: --max-old-space-size=96
`;
    assert.deepEqual(check(source), [
      "compose.yml: bare must set read_only: true",
      "compose.yml: bare must drop every capability (cap_drop: [ALL])",
      "compose.yml: bare must set security_opt no-new-privileges:true",
      "compose.yml: bare must mount a size-capped tmpfs on /tmp",
    ]);
  });

  it("fails on a missing memory limit, a heap below 60% and a port open to every interface", () => {
    const source = compose("")
      .replace("    mem_limit: 300m\n    depends_on", "    depends_on")
      .replace('"127.0.0.1:3001:3001"', '"3001:3001"');
    assert.deepEqual(check(source), [
      "compose.yml: app must set mem_limit (ADR-027)",
      "compose.yml: app publishes 3001:3001: bind it to 127.0.0.1 (ADR-027)",
    ]);
    const starved = compose("").replace("=224", "=150");
    assert.deepEqual(check(starved), [
      "compose.yml: app must set NODE_OPTIONS --max-old-space-size to at least 60% of mem_limit",
    ]);
  });

  it("fails when the heap plus the tmpfs sizes exceed 80% of mem_limit", () => {
    // 225 + 16 = 241 MB, one over 80% of 300.
    assert.deepEqual(check(compose("").replace("=224", "=225")), [
      "compose.yml: app heap 225 MB plus tmpfs 16 MB exceeds 80% of mem_limit (240 MB)",
    ]);
  });

  it("fails on web's step 5 numbers and accepts the reviewed ones", () => {
    const web = (heap, cache) => `${HARDENED}
services:
  web:
    <<: *hardened
    image: web:dev
    restart: unless-stopped
    tmpfs:
      - /tmp:size=16m
      - /app/.next/cache:size=${cache},uid=1000,gid=1000,mode=0700
    environment:
      NODE_OPTIONS: --max-old-space-size=${heap}
    mem_limit: 320m
`;
    assert.deepEqual(check(web(240, "64m")), [
      "compose.yml: web heap 240 MB plus tmpfs 80 MB exceeds 80% of mem_limit (256 MB)",
    ]);
    assert.deepEqual(check(web(208, "32m")), []);
  });

  it("fails on a tmpfs without a size", () => {
    assert.deepEqual(check(compose('\n    tmpfs: ["/tmp:size=16m", "/cache"]')), [
      "compose.yml: app must cap every tmpfs with size=",
    ]);
  });

  it("fails when a server can start before its migrate step completed", () => {
    const source = compose("").replace("service_completed_successfully", "service_started");
    assert.deepEqual(check(source), [
      "compose.yml: app must depend on app-migrate with condition: service_completed_successfully",
    ]);
  });

  it("fails when a migrate service restarts or keeps the image healthcheck", () => {
    const source = compose("").replace("<<: [*hardened, *migrate]", "<<: *hardened");
    const problems = check(source);
    assert.ok(
      problems.includes(
        'compose.yml: app-migrate is a one-off: set restart: "no" and disable its healthcheck',
      ),
    );
  });

  for (const [rule, extra, problem] of [
    ["privileged", "\n    privileged: true", "must not set privileged: true"],
    ["cap_add", "\n    cap_add: [NET_BIND_SERVICE]", "must not add capabilities (cap_add)"],
    ["user root", "\n    user: root", "must not run as root (user: root)"],
    ["user 0", '\n    user: "0"', "must not run as root (user: 0)"],
    ["user 0:0", '\n    user: "0:0"', "must not run as root (user: 0:0)"],
    ["network_mode host", "\n    network_mode: host", "must not set network_mode: host"],
    ["pid host", "\n    pid: host", "must not set pid: host"],
    ["ipc host", "\n    ipc: host", "must not set ipc: host"],
    [
      "docker.sock, short syntax",
      '\n    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]',
      "must not mount the Docker socket",
    ],
    [
      "docker.sock, long syntax",
      "\n    volumes:\n      - type: bind\n        source: /run/docker.sock\n        target: /sock",
      "must not mount the Docker socket",
    ],
  ]) {
    it(`fails when a service takes a privilege back: ${rule}`, () => {
      assert.deepEqual(check(compose(extra)), [`compose.yml: app ${problem}`]);
    });
  }
});

const DIGEST = `sha256:${"a".repeat(64)}`;

/** A small ops Compose file: one pinned, limited, healthchecked service publishing on 127.0.0.1. */
const ops = (extra = "", ports = '["127.0.0.1:15673:15672"]') => `
services:
  broker:
    image: broker:1.0@${DIGEST}
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
    ports: ${ports}
    healthcheck:
      test: ["CMD", "true"]
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
    mem_limit: 256m${extra}
`;

const checkOps = (source) => checkOpsHardening(parseComposeYaml(source), "ops.yml");

describe("the repository's compose.ops.yml", () => {
  it("pins, limits, binds and rotates every service, matches dev and pg_hba.conf", () => {
    const { services, problems } = checkOpsRepository();
    assert.deepEqual(services, ["postgres", "rabbitmq", "umami", "uptime-kuma"]);
    assert.deepEqual(problems, []);
  });
});

describe("checkOpsHardening", () => {
  it("accepts a pinned, limited, healthchecked service on 127.0.0.1", () => {
    assert.deepEqual(checkOps(ops()), []);
  });

  it("fails on an image pinned by tag only, a missing limit, healthcheck or no-new-privileges", () => {
    const source = ops()
      .replace(`@${DIGEST}`, "")
      .replace("    mem_limit: 256m", "")
      .replace('    security_opt: ["no-new-privileges:true"]\n', "")
      .replace('    healthcheck:\n      test: ["CMD", "true"]\n', "");
    assert.deepEqual(checkOps(source), [
      "ops.yml: broker must pin its image by digest (image: name:tag@sha256:...)",
      "ops.yml: broker must set mem_limit (ADR-027)",
      "ops.yml: broker must set security_opt no-new-privileges:true",
      "ops.yml: broker must define a healthcheck",
    ]);
  });

  for (const [rule, ports, problems] of [
    [
      "every interface",
      '["15673:15672"]',
      ["publishes 15673:15672: bind it to 127.0.0.1 (ADR-027)"],
    ],
    [
      "0.0.0.0",
      '["0.0.0.0:15673:15672"]',
      ["publishes 0.0.0.0:15673:15672: bind it to 127.0.0.1 (ADR-027)"],
    ],
    ["container port only", '["15672"]', ["publishes 15672: bind it to 127.0.0.1 (ADR-027)"]],
    [
      "Postgres on 127.0.0.1",
      '["127.0.0.1:5432:5432"]',
      ["publishes 127.0.0.1:5432:5432: port 5432 is never published (ADR-050)"],
    ],
    [
      "AMQP under another host port",
      '["127.0.0.1:15000:5672/tcp"]',
      ["publishes 127.0.0.1:15000:5672/tcp: port 5672 is never published (ADR-050)"],
    ],
    [
      "a range that covers the Erlang distribution port",
      '["127.0.0.1:25670-25680:25670-25680"]',
      ["publishes 127.0.0.1:25670-25680:25670-25680: port 25672 is never published (ADR-050)"],
    ],
    [
      "long syntax without host_ip",
      "\n      - target: 5672\n        published: 5672",
      [
        'publishes {"target":5672,"published":5672}: bind it to 127.0.0.1 (ADR-027)',
        'publishes {"target":5672,"published":5672}: port 5672 is never published (ADR-050)',
      ],
    ],
  ]) {
    it(`fails on a published port: ${rule}`, () => {
      assert.deepEqual(
        checkOps(ops("", ports)),
        problems.map((problem) => `ops.yml: broker ${problem}`),
      );
    });
  }

  it("fails when a service's logs do not rotate", () => {
    const keep = ops().replace('        max-file: "3"\n', "");
    const jsonFile = ops().replace("driver: local", "driver: json-file");
    for (const source of [keep, jsonFile, ops().replace(/ {4}logging:\n(.*\n){4}/, "")]) {
      assert.deepEqual(checkOps(source), [
        "ops.yml: broker must rotate its logs (logging: driver local, max-size and max-file)",
      ]);
    }
  });

  it("fails when Postgres or RabbitMQ may be killed before a clean shutdown", () => {
    const named = (name, extra = "") => ops(extra).replace("  broker:", `  ${name}:`);
    assert.deepEqual(checkOps(named("postgres")), [
      "ops.yml: postgres must set stop_grace_period to at least 60s",
    ]);
    assert.deepEqual(checkOps(named("rabbitmq", "\n    stop_grace_period: 30s")), [
      "ops.yml: rabbitmq must set stop_grace_period to at least 60s",
    ]);
    assert.deepEqual(checkOps(named("postgres", "\n    stop_grace_period: 1m")), []);
    assert.deepEqual(checkOps(named("rabbitmq", "\n    stop_grace_period: 1m30s")), []);
    // Any other service keeps Docker's default.
    assert.deepEqual(checkOps(ops()), []);
  });

  it("fails when RabbitMQ joins the ops network, in list or map form", () => {
    const rabbitmq = (networks) =>
      ops(`\n    stop_grace_period: 60s\n    networks: ${networks}`).replace(
        "  broker:",
        "  rabbitmq:",
      );
    assert.deepEqual(checkOps(rabbitmq("[jadero_prod, jadero_staging]")), []);
    for (const networks of ["[jadero_prod, jadero_ops]", "\n      jadero_ops: {}"]) {
      assert.deepEqual(checkOps(rabbitmq(networks)), [
        "ops.yml: rabbitmq must not join jadero_ops",
      ]);
    }
  });

  it("accepts long syntax bound to 127.0.0.1", () => {
    const ports = "\n      - target: 3000\n        published: 3100\n        host_ip: 127.0.0.1";
    assert.deepEqual(checkOps(ops("", ports)), []);
  });

  for (const [rule, extra, problem] of [
    ["privileged", "\n    privileged: true", "must not set privileged: true"],
    ["user root", "\n    user: root", "must not run as root (user: root)"],
    ["network_mode host", "\n    network_mode: host", "must not set network_mode: host"],
    [
      "docker.sock",
      '\n    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]',
      "must not mount the Docker socket",
    ],
  ]) {
    it(`fails when a service takes a privilege: ${rule}`, () => {
      assert.deepEqual(checkOps(ops(extra)), [`ops.yml: broker ${problem}`]);
    });
  }
});

describe("imageParityProblems", () => {
  const file = (postgres, rabbitmq) =>
    parseComposeYaml(`
services:
  postgres:
    image: ${postgres}
  rabbitmq:
    image: ${rabbitmq}
`);

  it("accepts the same references and fails on a different digest", () => {
    assert.deepEqual(imageParityProblems(file("pg@a", "mq@b"), file("pg@a", "mq@b")), []);
    assert.deepEqual(imageParityProblems(file("pg@a", "mq@b"), file("pg@a", "mq@c")), [
      "infra/compose/compose.ops.yml: rabbitmq runs mq@c, but infra/compose/compose.dev.yml runs mq@b: keep them equal",
    ]);
  });
});

describe("pgHbaProblems", () => {
  /** The ops networks and a Postgres on all three, as compose.ops.yml declares them. */
  const network = (subnet) => `\n    ipam:\n      config:\n        - subnet: ${subnet}`;
  const opsFile = (postgresNetworks = "[jadero_prod, jadero_staging, jadero_ops]") =>
    parseComposeYaml(`
services:
  postgres:
    networks: ${postgresNetworks}
networks:
  jadero_prod:${network("172.30.1.0/24")}
  jadero_staging:${network("172.30.2.0/24")}
  jadero_ops:${network("172.30.3.0/24")}
`);
  const HBA = `# comment
local   all             postgres                       peer
local   all             all                            reject
host    content_prod    content_prod   172.30.1.0/24   scram-sha-256
host    agent_staging   agent_staging  172.30.2.0/24   scram-sha-256  # trailing comment
host    umami           umami          172.30.3.0/24   scram-sha-256
host    all             all            0.0.0.0/0       reject
host    all             all            ::/0            reject
`;
  const check = (text, ops = opsFile()) => pgHbaProblems(parsePgHba(text), ops, "pg_hba.conf");

  it("parses rule lines with their line numbers and skips comments", () => {
    const entries = parsePgHba(HBA);
    assert.equal(entries.length, 7);
    assert.deepEqual(entries[0], {
      line: 2,
      type: "local",
      databases: ["all"],
      users: ["postgres"],
      address: null,
      method: "peer",
    });
    assert.deepEqual(entries[3], {
      line: 5,
      type: "host",
      databases: ["agent_staging"],
      users: ["agent_staging"],
      address: "172.30.2.0/24",
      method: "scram-sha-256",
    });
  });

  it("accepts each role on its environment's subnet, and ignores reject lines", () => {
    assert.deepEqual(check(HBA), []);
  });

  it("fails when a role is accepted from another environment's subnet", () => {
    const crossed = `${HBA}host content_prod content_prod 172.30.2.0/24 scram-sha-256\n`;
    assert.deepEqual(check(crossed), [
      "pg_hba.conf:9 accepts role content_prod from 172.30.2.0/24, but its network jadero_prod is 172.30.1.0/24",
    ]);
  });

  it("fails when a subnet belongs to no network, or to one Postgres does not join", () => {
    const stray = HBA.replace("172.30.1.0/24", "172.30.9.0/24");
    assert.deepEqual(check(stray), [
      "pg_hba.conf:4 names 172.30.9.0/24, the subnet of no network in infra/compose/compose.ops.yml",
      "pg_hba.conf:4 accepts role content_prod from 172.30.9.0/24, but its network jadero_prod is 172.30.1.0/24",
    ]);
    assert.deepEqual(check(HBA, opsFile("[jadero_prod, jadero_staging]")), [
      "pg_hba.conf:6 names jadero_ops, a network postgres does not join",
    ]);
  });

  it("fails on a role with no environment, a weaker method or an address that is not a subnet", () => {
    const loose = `${HBA}host all all 172.30.1.0/24 scram-sha-256
host content_prod content_prod 172.30.1.0/24 md5
host content_prod content_prod samenet scram-sha-256
`;
    assert.deepEqual(check(loose), [
      "pg_hba.conf:9 accepts role all, which belongs to no environment's network",
      "pg_hba.conf:10 uses md5: use scram-sha-256",
      "pg_hba.conf:11 accepts samenet: name a CIDR subnet",
    ]);
  });
});

// Compose and env file interpolation, written as plain strings on purpose: not JS placeholders.
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const ENV_VAR = "${JADERO_ENV}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const HOST_VAR = "${HOST}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const IMAGE_VAR = "${API_IMAGE:?from versions.env}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const IMAGE_HINT = "${API_IMAGE:?...}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const ENV_DIR = "/srv/jadero/${JADERO_ENV:?staging or prod}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a Compose variable
const ENV_DIR_HINT = "/srv/jadero/${JADERO_ENV:?...}";

/** The ops template's items for api, both environments, as ops.env.tpl lists them. */
const OPS_TEMPLATE = ["prod", "staging"]
  .map(
    (env) =>
      `X_${env}={{ op://jadero-ops/postgres-content-${env}/password }}\nY_${env}={{ op://jadero-ops/rabbitmq-api-${env}/password }}`,
  )
  .join("\n");

/** A small api template: two secrets from the environment's items, the server values. */
const API_TEMPLATE = `# api on the servers
NODE_ENV=production
LOG_LEVEL=info
OTEL_TRACES_EXPORTER=none
HEARTBEAT_INTERVAL_MS=60000
DATABASE_URL=postgres://content_\${JADERO_ENV}:{{ op://jadero-ops/postgres-content-$JADERO_ENV/password }}@postgres:5432/content_\${JADERO_ENV}
RABBITMQ_URL=amqp://api_\${JADERO_ENV}:{{ op://jadero-ops/rabbitmq-api-$JADERO_ENV/password }}@rabbitmq:5672/%2F\${JADERO_ENV}
`;

const checkTemplate = (source) =>
  envTemplateProblems(parseEnvTemplate(source), "api", OPS_TEMPLATE, "api.env.tpl");

const SERVICES_HEADER = `
x-hardened: &hardened
  read_only: true
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  tmpfs: ["/tmp:size=16m"]
  logging:
    driver: local
    options:
      max-size: "10m"
      max-file: "3"
x-migrate: &migrate
  restart: "no"
  healthcheck:
    disable: true
`;

/** A small services file: api's migrate step and the worker, on the rendered env file. */
const services = (worker = "", migrate = "") => `${SERVICES_HEADER}
services:
  api-migrate:
    <<: [*hardened, *migrate]
    image: \${API_IMAGE:?from versions.env}
    env_file:
      - path: /srv/jadero/\${JADERO_ENV:?staging or prod}/api.env
        required: true
    environment:
      RABBITMQ_URL: ""
    mem_limit: 300m${migrate}
  api-worker:
    <<: *hardened
    image: \${API_IMAGE:?from versions.env}
    restart: unless-stopped
    env_file:
      - path: /srv/jadero/\${JADERO_ENV:?staging or prod}/api.env
        required: true
    environment:
      PORT: "3011"
      OTEL_SERVICE_NAME: api-worker
      NODE_OPTIONS: --max-old-space-size=224
    mem_limit: 300m
    depends_on:
      api-migrate:
        condition: service_completed_successfully${worker}
`;

const API_TEMPLATES = { api: parseEnvTemplate(API_TEMPLATE) };
const checkServices = (source) =>
  checkServicesHardening(parseComposeYaml(source), API_TEMPLATES, "services.yml");

describe("the repository's compose.services.yml with both overlays and the env templates", () => {
  it("hardens every process type, blanks unused credentials and publishes only api and web", () => {
    const { services, problems } = checkServicesRepository();
    assert.deepEqual(services, [
      "agent",
      "agent-consumer",
      "agent-migrate",
      "api",
      "api-migrate",
      "api-worker",
      "web",
    ]);
    assert.deepEqual(problems, []);
  });
});

describe("envTemplateProblems", () => {
  it("accepts references to the environment's items and the server values", () => {
    assert.deepEqual(checkTemplate(API_TEMPLATE), []);
  });

  it("fails on a credential in clear, a secret-like name without a reference, another variable", () => {
    const source = API_TEMPLATE.replace(
      "{{ op://jadero-ops/postgres-content-$JADERO_ENV/password }}",
      "hunter2",
    )
      .concat("UMAMI_APP_SECRET=plain\n")
      .concat(`SITE_URL=https://${HOST_VAR}\n`);
    assert.deepEqual(checkTemplate(source), [
      "api.env.tpl:6 DATABASE_URL carries a credential in clear: use a 1Password reference",
      "api.env.tpl:8 UMAMI_APP_SECRET looks like a secret: use a 1Password reference",
      `api.env.tpl:9 SITE_URL: only ${ENV_VAR} may be interpolated outside a reference`,
    ]);
  });

  it("fails on a reference in a comment, a fixed environment and an item ops.env.tpl lacks", () => {
    const source = API_TEMPLATE.replace(
      "# api on the servers",
      "# from {{ op://jadero-ops/postgres-content-prod/password }}",
    )
      .replace("rabbitmq-api-$JADERO_ENV", "rabbitmq-api-prod")
      .concat("X={{ op://jadero-ops/postgres-other-$JADERO_ENV/password }}\n");
    assert.deepEqual(checkTemplate(source), [
      "api.env.tpl:1 holds a secret reference in a comment: op inject resolves it",
      "api.env.tpl:7 RABBITMQ_URL: every reference must read {{ op://jadero-ops/<item>-$JADERO_ENV/password }}",
      "api.env.tpl:8 X: item postgres-other-staging is not in infra/env/ops.env.tpl",
      "api.env.tpl:8 X: item postgres-other-prod is not in infra/env/ops.env.tpl",
    ]);
  });

  it("fails when a server value is missing or wrong", () => {
    const source = API_TEMPLATE.replace("LOG_LEVEL=info", "LOG_LEVEL=debug").replace(
      "OTEL_TRACES_EXPORTER=none\n",
      "",
    );
    assert.deepEqual(checkTemplate(source), [
      "api.env.tpl: LOG_LEVEL must be info on the servers",
      "api.env.tpl: OTEL_TRACES_EXPORTER must be none on the servers",
    ]);
  });
});

describe("checkServicesHardening", () => {
  it("accepts process types on their image variable, their env file and blanked credentials", () => {
    assert.deepEqual(checkServices(services()), []);
  });

  it("fails on an image by tag, a build and a published port", () => {
    const source = services('\n    build: .\n    ports: ["127.0.0.1:3011:3011"]').replace(
      `image: ${IMAGE_VAR}\n    restart`,
      "image: ghcr.io/josealbdr/jadero-dev-api:0.2.0\n    restart",
    );
    assert.deepEqual(checkServices(source), [
      `services.yml: api-worker must run ${IMAGE_HINT} from versions.env (a digest reference)`,
      "services.yml: api-worker must not build: servers pull by digest",
      "services.yml: api-worker must not publish ports here: the environment overlays do",
    ]);
  });

  it("fails when a process type keeps a credential it does not read, or overrides its own", () => {
    const keeps = services().replace('      RABBITMQ_URL: ""\n', "");
    assert.deepEqual(checkServices(keeps), [
      'services.yml: api-migrate must blank RABBITMQ_URL (environment: RABBITMQ_URL: ""): it does not read it',
    ]);
    const overrides = services().replace(
      'PORT: "3011"',
      'PORT: "3011"\n      RABBITMQ_URL: amqp://elsewhere',
    );
    assert.deepEqual(checkServices(overrides), [
      "services.yml: api-worker must take RABBITMQ_URL from its env file, not override it",
    ]);
  });

  it("fails on another service's env file, an optional one, or a fixed environment folder", () => {
    for (const path of [`${ENV_DIR}/agent.env`, "/srv/jadero/staging/api.env"]) {
      const source = services().replace(
        `${ENV_DIR}/api.env\n        required: true\n    environment:\n      PORT`,
        `${path}\n        required: true\n    environment:\n      PORT`,
      );
      assert.deepEqual(checkServices(source), [
        `services.yml: api-worker must read only ${ENV_DIR_HINT}/api.env, required (env_file)`,
      ]);
    }
    const optional = services().replace(
      "required: true\n    environment:\n      PORT",
      "required: false\n    environment:\n      PORT",
    );
    assert.equal(checkServices(optional).length, 1);
  });

  it("fails on a network, unrotated logs, a peer dependency and an unlisted process type", () => {
    const source = services(
      "\n      postgres:\n        condition: service_healthy\n    networks: [jadero_prod]\n    logging:\n      driver: json-file",
    ).replace("  api-worker:", "  api-relay:");
    assert.deepEqual(checkServices(source), [
      "services.yml: api-relay must stay on the default network, which each overlay names",
      "services.yml: api-relay must rotate its logs (logging: driver local, max-size and max-file)",
      "services.yml: api-relay must not depend on postgres: only on its own migrate step",
      "services.yml: api-relay is a process type with no credential list: add it to PROCESS_SECRETS",
    ]);
  });
});

describe("checkEnvironmentOverlay", () => {
  const base = parseComposeYaml(`
services:
  api: {}
  api-worker: {}
  web: {}
`);
  const ops = parseComposeYaml(`
networks:
  jadero_staging:
    name: jadero_staging
`);
  const overlay = (extra = "", network = "jadero_staging") => `
name: jadero-staging
services:
  api:
    ports: ["127.0.0.1:3121:3001"]
  web:
    ports: ["127.0.0.1:3120:3000"]
    environment:
      SITE_URL: https://new.jadero.dev${extra}
networks:
  default:
    name: ${network}
    external: true
`;
  const checkOverlay = (source) =>
    checkEnvironmentOverlay(parseComposeYaml(source), "staging", base, ops);

  it("accepts the project name, api and web on 127.0.0.1 and the external network", () => {
    assert.deepEqual(checkOverlay(overlay()), []);
  });

  it("fails when a worker publishes, a port leaves 127.0.0.1 or moves", () => {
    const source = overlay('\n  api-worker:\n    ports: ["127.0.0.1:3011:3011"]')
      .replace("127.0.0.1:3121:3001", "3121:3001")
      .replace("3120:3000", "3130:3000");
    assert.deepEqual(checkOverlay(source), [
      "infra/compose/compose.staging.yml: api publishes 3121:3001: bind it to 127.0.0.1 (ADR-027)",
      "infra/compose/compose.staging.yml: api must publish exactly 127.0.0.1:3121:3001",
      "infra/compose/compose.staging.yml: web must publish exactly 127.0.0.1:3120:3000",
      "infra/compose/compose.staging.yml: api-worker publishes a port: only api and web do",
    ]);
  });

  it("fails on another project, network or a network the project would create", () => {
    const named = overlay("", "jadero_prod").replace("name: jadero-staging", "name: jadero-prod");
    assert.deepEqual(checkOverlay(named), [
      "infra/compose/compose.staging.yml must name the project jadero-staging",
      "infra/compose/compose.staging.yml must join only jadero_staging, as the external default network",
    ]);
    assert.deepEqual(checkOverlay(overlay().replace("    external: true\n", "")), [
      "infra/compose/compose.staging.yml must join only jadero_staging, as the external default network",
    ]);
  });

  it("fails when an overlay sets more than ports and the allowed variables", () => {
    const source = overlay("\n      DATABASE_URL: postgres://x\n    mem_limit: 2g").concat(
      "volumes:\n  data: {}\n",
    );
    assert.deepEqual(checkOverlay(source), [
      "infra/compose/compose.staging.yml must hold only name, services and networks (found volumes)",
      "infra/compose/compose.staging.yml: web must set only ports and environment (found mem_limit)",
      "infra/compose/compose.staging.yml: web must not set DATABASE_URL: it belongs in the env template",
    ]);
  });
});

describe("missingVariableProblems", () => {
  it("fails when a blanked credential is one the process type requires", () => {
    const source = services().replace('PORT: "3011"', 'PORT: "3011"\n      DATABASE_URL: ""');
    assert.deepEqual(
      missingVariableProblems(parseComposeYaml(source), {}, API_TEMPLATES, "overlay.yml"),
      ["overlay.yml: api-worker gets no DATABASE_URL, which its config requires"],
    );
    assert.deepEqual(
      missingVariableProblems(parseComposeYaml(services()), {}, API_TEMPLATES, "overlay.yml"),
      [],
    );
  });
});
