import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDefinitions,
  DEV_USERS,
  DEV_VHOST,
  delayLabel,
  JADERO_QUEUES,
  retryQueueName,
} from "../src/index.js";

type Queue = { name: string; arguments: Record<string, unknown> };
type Binding = { source: string; destination: string; routing_key: string };
type Permission = { user: string; configure: string; write: string; read: string };
type User = { name: string; password_hash: string };

const committed = JSON.parse(
  readFileSync(new URL("../../../infra/rabbitmq/definitions.json", import.meta.url), "utf8"),
) as { queues: Queue[]; bindings: Binding[]; permissions: Permission[]; users: User[] };

describe("infra/rabbitmq/definitions.json", () => {
  it("is generated from the topology module (run `pnpm --filter @jadero/messaging topology`)", () => {
    expect(committed).toEqual(
      buildDefinitions({ vhost: DEV_VHOST, queues: JADERO_QUEUES, users: DEV_USERS }),
    );
  });

  it("gives every consumer queue three wait queues that return to it, and a DLQ", () => {
    for (const { name } of JADERO_QUEUES) {
      const main = committed.queues.find((q) => q.name === name);
      expect(main?.arguments).toMatchObject({
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "jadero.dlx",
        "x-dead-letter-strategy": "at-least-once",
        "x-overflow": "reject-publish",
      });
      for (const [label, ttl] of [
        ["10s", 10_000],
        ["1m", 60_000],
        ["10m", 600_000],
      ] as const) {
        const wait = committed.queues.find((q) => q.name === `${name}.retry.${label}`);
        // Back through the default exchange to this queue only: other consumers never see a retry.
        expect(wait?.arguments).toMatchObject({
          "x-message-ttl": ttl,
          "x-dead-letter-exchange": "",
          "x-dead-letter-routing-key": name,
        });
      }
      expect(committed.bindings).toContainEqual(
        expect.objectContaining({
          source: "jadero.dlx",
          destination: `${name}.dlq`,
          routing_key: name,
        }),
      );
    }
  });

  it("sends unroutable events to jadero.unrouted instead of dropping them", () => {
    const exchanges = (committed as unknown as { exchanges: { name: string; arguments: object }[] })
      .exchanges;
    expect(exchanges.find((e) => e.name === "jadero.events")?.arguments).toEqual({
      "alternate-exchange": "jadero.unrouted",
    });
  });

  it("gives service users no configure right and only their own queues", () => {
    const byUser = new Map(committed.permissions.map((p) => [p.user, p]));
    const api = byUser.get("api");
    const agent = byUser.get("agent");
    expect(api).toMatchObject({ configure: "^$", read: "^$" });
    expect(new RegExp(api?.write ?? "").test("jadero.events")).toBe(true);
    expect(agent).toMatchObject({ configure: "^$" });
    expect(new RegExp(agent?.read ?? "").test("agent.system.ping")).toBe(true);
    expect(new RegExp(agent?.read ?? "").test("agent.system.ping.dlq")).toBe(false);
    expect(new RegExp(agent?.write ?? "").test("jadero.events")).toBe(false);
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
