// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkComposeHardening,
  checkOpsHardening,
  checkOpsRepository,
  checkRepository,
  imageParityProblems,
  parseComposeYaml,
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
