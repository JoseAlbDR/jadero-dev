import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { systemPingV1 } from "@jadero/contracts";
import { useDockerContextHost } from "@jadero/testing";
import { connect } from "amqplib";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENTS_EXCHANGE } from "../src/index.js";
import { RABBITMQ_IMAGE } from "./setup/images.js";

// The servers' broker as WP-8 D4 builds it: the pinned image booted with infra/rabbitmq/server's
// rabbitmq.conf and its per-vhost definitions (no users), then infra/rabbitmq/provision-users.sh
// run twice, as two deploys would.

const SCRIPT = fileURLToPath(
  new URL("../../../infra/rabbitmq/provision-users.sh", import.meta.url),
);
const CONF = fileURLToPath(
  new URL("../../../infra/rabbitmq/server/rabbitmq.conf", import.meta.url),
);
const DEFINITIONS = fileURLToPath(
  new URL("../../../infra/rabbitmq/server/definitions", import.meta.url),
);

/** A fresh password per server user, hex only; test-only values, never printed. */
const PASSWORDS = Object.fromEntries(
  ["api_prod", "agent_prod", "api_staging", "agent_staging", "ops_admin"].map((user) => [
    user,
    randomBytes(16).toString("hex"),
  ]),
);
const passwordEnv = Object.fromEntries(
  Object.entries(PASSWORDS).map(([user, pw]) => [`RABBITMQ_${user.toUpperCase()}_PASSWORD`, pw]),
);

let container: StartedTestContainer;

/** Runs rabbitmqctl in the broker and returns its output, failing the test on a non-zero exit. */
async function ctl(...args: string[]): Promise<string> {
  const result = await container.exec(["rabbitmqctl", "--quiet", ...args]);
  expect(result.exitCode, result.output).toBe(0);
  return result.output;
}

/** The first column of a rabbitmqctl listing, sorted. */
async function names(...args: string[]): Promise<string[]> {
  const output = await ctl(...args, "--no-table-headers");
  return output
    .split("\n")
    .map((line) => line.split("\t")[0] ?? "")
    .filter((name) => name !== "")
    .sort();
}

/** Runs the provisioning script and returns its exit code and combined output. */
function provision(extraEnv: Record<string, string> = passwordEnv, args: string[] = []) {
  const result = spawnSync(SCRIPT, args, {
    env: { ...process.env, RABBITMQ_CONTAINER: container.getId(), ...extraEnv },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** An AMQP URL for one user and vhost of the test broker. */
function amqpUrl(user: string, vhost: string): string {
  const host = `${container.getHost()}:${container.getMappedPort(5672)}`;
  return `amqp://${user}:${PASSWORDS[user]}@${host}/${encodeURIComponent(vhost)}`;
}

beforeAll(async () => {
  useDockerContextHost();
  container = await new GenericContainer(RABBITMQ_IMAGE)
    .withCopyFilesToContainer([{ source: CONF, target: "/etc/rabbitmq/conf.d/20-jadero.conf" }])
    .withCopyDirectoriesToContainer([{ source: DEFINITIONS, target: "/etc/rabbitmq/definitions" }])
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .withStartupTimeout(120_000)
    .start();
  // An operator's user created by hand before the first deploy: reported, never deleted.
  await ctl("add_user", "stray_operator", randomBytes(8).toString("hex"));
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe("the servers' RabbitMQ provisioning", () => {
  it("boots with the two vhosts, no guest and no default vhost", async () => {
    expect(await names("list_vhosts")).toEqual(["/prod", "/staging"]);
    expect(await names("list_users")).toEqual(["stray_operator"]);
    expect(await names("list_queues", "-p", "/prod")).toContain("agent.system.ping");
  });

  it("refuses to change anything while a password is missing, naming only the variable", () => {
    const { RABBITMQ_AGENT_PROD_PASSWORD: _, ...rest } = passwordEnv;
    const run = provision(rest, ["prod"]);
    expect(run.status).toBe(1);
    expect(run.output).toContain("RABBITMQ_AGENT_PROD_PASSWORD is not set");
    for (const pw of Object.values(PASSWORDS)) expect(run.output).not.toContain(pw);
  });

  it("converges the users twice with the same result, never printing a password", async () => {
    const first = provision();
    expect(first.status, first.output).toBe(0);
    const permissionsAfterFirst = await ctl("list_permissions", "-p", "/prod");
    const second = provision();
    expect(second.status, second.output).toBe(0);
    expect(second.output).toContain("agent_prod: password set");
    expect(await ctl("list_permissions", "-p", "/prod")).toBe(permissionsAfterFirst);
    for (const output of [first.output, second.output]) {
      for (const pw of Object.values(PASSWORDS)) expect(output).not.toContain(pw);
      expect(output).toContain("WARN stray_operator is not in permissions.tsv");
    }
    expect(await names("list_users")).toEqual([
      "agent_prod",
      "agent_staging",
      "api_prod",
      "api_staging",
      "ops_admin",
      "stray_operator",
    ]);
    expect(await ctl("list_users")).toMatch(/^ops_admin\t\[administrator\]$/m);
  });

  it("lets api_prod publish and agent_prod consume on /prod, and nothing else", async () => {
    const publisher = await connect(amqpUrl("api_prod", "/prod"));
    const consumer = await connect(amqpUrl("agent_prod", "/prod"));
    try {
      const out = await publisher.createConfirmChannel();
      out.publish(EVENTS_EXCHANGE, systemPingV1.routingKey, Buffer.from("{}"));
      await out.waitForConfirms();
      const channel = await consumer.createChannel();
      // The refused declare below closes this channel; the error is asserted, not unhandled.
      channel.on("error", () => undefined);
      let message: Awaited<ReturnType<typeof channel.get>> = false;
      for (let i = 0; i < 20 && message === false; i++) {
        message = await channel.get("agent.system.ping", { noAck: true });
        if (message === false) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(message && message.content.toString()).toBe("{}");
      // No configure right: declaring a queue closes the channel with ACCESS_REFUSED.
      await expect(channel.assertQueue("agent.scratch")).rejects.toThrow(/ACCESS_REFUSED/);
    } finally {
      await publisher.close();
      await consumer.close();
    }
    // Same user and password, other vhost: the broker closes the connection during the
    // handshake, because agent_prod holds rights on /prod only.
    await expect(connect(amqpUrl("agent_prod", "/staging"))).rejects.toThrow(/ConnectionClose/);
    expect(await names("list_user_permissions", "agent_prod")).toEqual(["/prod"]);
  });

  it("keeps the users and permissions across a broker restart", async () => {
    const before = await ctl("list_permissions", "-p", "/staging");
    await container.restart();
    for (let i = 0; i < 60; i++) {
      if ((await container.exec(["rabbitmqctl", "await_startup"])).exitCode === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(await names("list_users")).toEqual([
      "agent_prod",
      "agent_staging",
      "api_prod",
      "api_staging",
      "ops_admin",
      "stray_operator",
    ]);
    expect(await ctl("list_permissions", "-p", "/staging")).toBe(before);
    expect(await names("list_vhosts")).toEqual(["/prod", "/staging"]);
    // The password survives too: the import at boot is additive and never touches users.
    const auth = await container.exec([
      "rabbitmqctl",
      "authenticate_user",
      "agent_staging",
      PASSWORDS.agent_staging ?? "",
    ]);
    expect(auth.exitCode).toBe(0);
  });
}, 300_000);
