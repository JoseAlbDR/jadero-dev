import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDefinitions,
  buildPermissions,
  DEV_USERS,
  DEV_VHOST,
  delayLabel,
  JADERO_QUEUES,
  renderPermissionsTable,
  retryQueueName,
  SERVER_ENVIRONMENTS,
} from "../src/index.js";

type Queue = { name: string; arguments: Record<string, unknown> };
type Binding = { source: string; destination: string; routing_key: string };
type Permission = { user: string; configure: string; write: string; read: string };
type User = { name: string; password_hash: string };
type Policy = { name: string; pattern: string; definition: Record<string, unknown> };

const committed = JSON.parse(
  readFileSync(new URL("../../../infra/rabbitmq/definitions.json", import.meta.url), "utf8"),
) as {
  queues: Queue[];
  bindings: Binding[];
  permissions: Permission[];
  users: User[];
  policies: Policy[];
};
const policyOf = (queue: string) =>
  committed.policies.find((p) => new RegExp(p.pattern).test(queue));

describe("infra/rabbitmq/definitions.json", () => {
  it("is generated from the topology module (run `pnpm --filter @jadero/messaging topology`)", () => {
    expect(committed).toEqual(
      buildDefinitions({ vhost: DEV_VHOST, queues: JADERO_QUEUES, users: DEV_USERS }),
    );
  });

  it("gives every consumer queue three wait queues that return to it, and a DLQ", () => {
    for (const { name, service } of JADERO_QUEUES) {
      const retry = `${service}.retry`;
      // The type is the only argument; everything that may change later is a policy.
      expect(committed.queues.find((q) => q.name === name)?.arguments).toEqual({
        "x-queue-type": "quorum",
      });
      expect(policyOf(name)?.definition).toEqual({
        "dead-letter-strategy": "at-least-once",
        overflow: "reject-publish",
        "dead-letter-exchange": "jadero.dlx",
        "dead-letter-routing-key": name,
        "delivery-limit": 20,
      });
      for (const [label, ttl] of [
        ["10s", 10_000],
        ["1m", 60_000],
        ["10m", 600_000],
      ] as const) {
        const wait = `${name}.retry.${label}`;
        expect(committed.queues.find((q) => q.name === wait)?.arguments).toEqual({
          "x-queue-type": "quorum",
        });
        // Back through the retry exchange to this queue only: other consumers never see a retry.
        expect(policyOf(wait)?.definition).toMatchObject({
          "message-ttl": ttl,
          "dead-letter-exchange": retry,
          "dead-letter-routing-key": name,
        });
      }
      expect(committed.bindings).toContainEqual(
        expect.objectContaining({ source: retry, destination: name, routing_key: name }),
      );
      expect(committed.bindings).toContainEqual(
        expect.objectContaining({
          source: "jadero.dlx",
          destination: `${name}.dlq`,
          routing_key: name,
        }),
      );
      for (const target of [
        `${name}.retry.10s`,
        `${name}.retry.1m`,
        `${name}.retry.10m`,
        `${name}.dlq`,
      ]) {
        expect(committed.bindings).toContainEqual(
          expect.objectContaining({
            source: retry,
            destination: target,
            routing_key: target,
          }),
        );
      }
    }
  });

  it("sends unroutable events and copies to jadero.unrouted instead of dropping them", () => {
    const exchanges = (committed as unknown as { exchanges: { name: string; arguments: object }[] })
      .exchanges;
    for (const name of ["jadero.events", "agent.retry", "api.retry"]) {
      expect(exchanges.find((e) => e.name === name)?.arguments).toEqual({
        "alternate-exchange": "jadero.unrouted",
      });
    }
  });

  it("gives service users no configure right and only their own queues", () => {
    const byUser = new Map(committed.permissions.map((p) => [p.user, p]));
    const api = byUser.get("api");
    const agent = byUser.get("agent");
    expect(api).toMatchObject({ configure: "^$" });
    expect(new RegExp(api?.write ?? "").test("jadero.events")).toBe(true);
    // api-worker's revalidation consumer reads its own queue and retries through api.retry only.
    expect(new RegExp(api?.read ?? "").test("api.revalidate")).toBe(true);
    expect(new RegExp(api?.read ?? "").test("api.revalidate.dlq")).toBe(false);
    expect(new RegExp(api?.read ?? "").test("agent.system.ping")).toBe(false);
    expect(new RegExp(api?.write ?? "").test("api.retry")).toBe(true);
    expect(new RegExp(api?.write ?? "").test("agent.retry")).toBe(false);
    expect(new RegExp(agent?.read ?? "").test("api.revalidate")).toBe(false);
    expect(agent).toMatchObject({ configure: "^$" });
    expect(new RegExp(agent?.read ?? "").test("agent.system.ping")).toBe(true);
    expect(new RegExp(agent?.read ?? "").test("agent.system.ping.dlq")).toBe(false);
    expect(new RegExp(agent?.write ?? "").test("jadero.events")).toBe(false);
    // Retries go through its own exchange, not the default one, which reaches every queue.
    expect(new RegExp(agent?.write ?? "").test("agent.retry")).toBe(true);
    expect(new RegExp(agent?.write ?? "").test("amq.default")).toBe(false);
  });

  it("stores the dev passwords as RabbitMQ salted sha256 hashes", () => {
    for (const user of DEV_USERS) {
      const stored = Buffer.from(
        committed.users.find((u) => u.name === user.name)?.password_hash ?? "",
        "base64",
      );
      const salt = stored.subarray(0, 4);
      const expected = createHash("sha256")
        .update(Buffer.concat([salt, Buffer.from(user.password)]))
        .digest();
      expect(stored.subarray(4)).toEqual(expected);
    }
  });
});

const serverFile = (name: string) =>
  readFileSync(new URL(`../../../infra/rabbitmq/server/${name}`, import.meta.url), "utf8");
const serverPermissionInputs = SERVER_ENVIRONMENTS.map((env) => ({
  vhost: env.vhost,
  queues: JADERO_QUEUES,
  users: env.users,
}));

describe("infra/rabbitmq/server (staging and production, WP-8 D4)", () => {
  it("holds one definitions file per vhost, generated without users or permissions", () => {
    // RabbitMQ imports every file of a load_definitions directory, whatever its extension.
    expect(
      readdirSync(new URL("../../../infra/rabbitmq/server/definitions", import.meta.url)).sort(),
    ).toEqual(["prod.json", "staging.json"]);
    expect(serverFile("rabbitmq.conf")).toMatch(
      /^load_definitions = \/etc\/rabbitmq\/definitions$/m,
    );
    for (const env of SERVER_ENVIRONMENTS) {
      const text = serverFile(`definitions/${env.name}.json`);
      expect(JSON.parse(text)).toEqual(
        buildDefinitions({ vhost: env.vhost, queues: JADERO_QUEUES }),
      );
      expect(JSON.parse(text)).toMatchObject({
        users: [],
        permissions: [],
        vhosts: [{ name: env.vhost }],
      });
      expect(text).not.toContain("password");
    }
  });

  it("declares every queue of every file as quorum, with its type as the only argument", () => {
    // A live import keeps an existing queue's type whatever the file says (RabbitMQ 4.3.6, pinned
    // in topology-import.int.test.ts), so a type never changes in place: a queue that needs
    // another type is a new name, and this test is where such a change shows up (ADR-053).
    const files = [
      committed,
      ...SERVER_ENVIRONMENTS.map(
        (env) => JSON.parse(serverFile(`definitions/${env.name}.json`)) as { queues: Queue[] },
      ),
    ];
    for (const file of files) {
      expect(file.queues.length).toBeGreaterThan(0);
      for (const queue of file.queues) {
        expect(queue.arguments, queue.name).toEqual({ "x-queue-type": "quorum" });
      }
    }
  });

  it("names a user per service and vhost, plus ops_admin on both, and holds no password", () => {
    expect(SERVER_ENVIRONMENTS.map((env) => [env.vhost, env.users.map((u) => u.name)])).toEqual([
      ["/prod", ["api_prod", "agent_prod", "ops_admin"]],
      ["/staging", ["api_staging", "agent_staging", "ops_admin"]],
    ]);
    for (const user of SERVER_ENVIRONMENTS.flatMap((env) => env.users)) {
      expect(user).not.toHaveProperty("password");
    }
  });

  it("writes permissions.tsv from buildPermissions (run `pnpm --filter @jadero/messaging topology`)", () => {
    const text = serverFile("permissions.tsv");
    expect(text).toBe(renderPermissionsTable(serverPermissionInputs));
    const rows = text
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split("\t"));
    expect(rows.every((row) => row.length === 6 && row.every((field) => field !== ""))).toBe(true);
    expect(
      rows.map(([user, vhost, , configure, write, read]) => ({
        user,
        vhost,
        configure,
        write,
        read,
      })),
    ).toEqual(serverPermissionInputs.flatMap((input) => buildPermissions(input)));
    expect(rows.map(([user, , tags]) => `${user}:${tags}`)).toEqual([
      "api_prod:-",
      "agent_prod:-",
      "ops_admin:administrator",
      "api_staging:-",
      "agent_staging:-",
      "ops_admin:administrator",
    ]);
  });

  it("gives a service the same rights on the servers as in dev", () => {
    const rights = ({ configure, write, read }: Permission) => ({ configure, write, read });
    const dev = new Map(committed.permissions.map((p) => [p.user, rights(p)]));
    for (const input of serverPermissionInputs) {
      for (const row of buildPermissions(input)) {
        const service = row.user === "ops_admin" ? "dev" : row.user.replace(/_(prod|staging)$/, "");
        expect(rights(row), `${row.user} on ${row.vhost}`).toEqual(dev.get(service));
      }
    }
  });
});

describe("buildPermissions", () => {
  it("reads the queues of the user's service, which defaults to its name", () => {
    const queues = [{ name: "agent.x", service: "agent", bindings: ["a"] }];
    const [named, mapped, other] = buildPermissions({
      vhost: "/v",
      queues,
      users: [{ name: "agent" }, { name: "agent_v", service: "agent" }, { name: "agent_v2" }],
    });
    expect(named?.read).toBe("^(agent\\.x)$");
    expect(mapped).toEqual({ ...named, user: "agent_v" });
    // A user whose service has no queues reads nothing and writes nothing.
    expect(other).toMatchObject({ configure: "^$", write: "^$", read: "^$" });
  });

  it("leaves users and permissions out of definitions built without users", () => {
    expect(buildDefinitions({ vhost: "/v", queues: [] })).toMatchObject({
      users: [],
      permissions: [],
    });
  });
});

describe("queue names", () => {
  it.each([
    [10_000, "10s"],
    [60_000, "1m"],
    [600_000, "10m"],
    [20, "20ms"],
  ])("labels %d ms as %s", (ms, label) => {
    expect(delayLabel(ms)).toBe(label);
  });

  it("names wait queues after their consumer queue and tier", () => {
    expect(retryQueueName("agent.system.ping", 60_000)).toBe("agent.system.ping.retry.1m");
  });
});
