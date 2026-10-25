import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { contentPublishedV1, REVALIDATE_SIGNATURE_HEADER } from "@jadero/contracts";
import { createEnvelope, type Delivery } from "@jadero/messaging";
import { runMigrations } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpWebCache } from "../src/modules/revalidation/http-web-cache.js";
import { REVALIDATE_QUEUE } from "../src/modules/revalidation/revalidation.consumer.js";
import { RevalidationService } from "../src/modules/revalidation/revalidation.service.js";
import { changesForPublished } from "../src/modules/revalidation/revalidation-changes.js";
import { RevalidationInbox } from "../src/modules/revalidation/revalidation-inbox.js";
import { signRevalidation } from "../src/modules/revalidation/revalidation-signature.js";
import { recordingLogger } from "./revalidation.fakes.js";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-14 step 5 on Postgres (ADR-012, D5): the revalidation service with the real inbox in
// `messaging.inbox` and the real signed HTTP call to a stub web. A first delivery calls web and
// records the event; a duplicate finds the row and never calls; a 503 is a retry that records
// nothing; a 401 is dead. Tests run one after another and each starts from an empty inbox.
const SECRET = "a-test-secret-of-at-least-32-characters";

let pool: pg.Pool;
let drop: () => Promise<void>;
let server: Server;
let service: RevalidationService;
let status = 204;
const calls: { signature: string | undefined; body: string }[] = [];

beforeAll(async () => {
  const database = await createContentTestDatabase();
  drop = database.drop;
  await runMigrations({
    service: "api",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  pool = new pg.Pool({ connectionString: database.url, max: 2 });
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const signature = req.headers[REVALIDATE_SIGNATURE_HEADER];
      calls.push({ signature: typeof signature === "string" ? signature : undefined, body });
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revalidate`;
  service = new RevalidationService(
    new RevalidationInbox(pool),
    new HttpWebCache({ url, secret: SECRET }),
    recordingLogger().log,
  );
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await drop();
});

beforeEach(async () => {
  await pool.query("TRUNCATE messaging.inbox");
  calls.length = 0;
  status = 204;
});

/** A fresh `content.published.v1` delivery of the project fixture's data, with a new event id. */
function delivery() {
  const envelope = createEnvelope(
    contentPublishedV1,
    {
      aggregate: "project",
      id: "0199f3a2-1b7c-7e10-8d4f-2a6b9c0d1e3f",
      locale: "de",
      revision: { id: "01a1a0e4-7850-7d22-a6b1-0c1d2e3f4a5b", number: 7 },
      publishedAt: "2026-11-03T10:12:00.120Z",
      item: { slug: "jobs-hub", kind: "project", featured: true, sortOrder: 2 },
      document: {
        slug: "jobportal",
        title: "Jobportal",
        summary: "Eine Jobbörse.",
        body: "## Problem",
        stackTags: ["NestJS"],
        repoUrl: null,
        demoUrl: null,
      },
    },
    "jadero/api",
  );
  return { envelope, queue: REVALIDATE_QUEUE, attempt: 1 } as Delivery<typeof envelope>;
}

/** Handles one delivery the way the consumer does. */
function handle(event: ReturnType<typeof delivery>) {
  return service.revalidate(event, changesForPublished(event.envelope.data));
}

/** The inbox rows, as `consumer|event_id|type`. */
async function inboxRows(): Promise<string[]> {
  const { rows } = await pool.query<{ row: string }>(
    "SELECT consumer || '|' || event_id || '|' || type AS row FROM messaging.inbox",
  );
  return rows.map((r) => r.row);
}

describe("revalidation on Postgres with a stub web (check, act, record)", () => {
  it("calls web once with the signed changes, then records the event", async () => {
    const event = delivery();
    await expect(handle(event)).resolves.toEqual({ kind: "done" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(JSON.parse(call?.body ?? "")).toEqual({
      changes: [{ kind: "project", id: "0199f3a2-1b7c-7e10-8d4f-2a6b9c0d1e3f", slug: "jobportal" }],
    });
    const timestamp = Number(call?.signature?.match(/^t=(\d+),/)?.[1]);
    expect(call?.signature).toBe(signRevalidation(SECRET, call?.body ?? "", timestamp));
    expect(await inboxRows()).toEqual([
      `${REVALIDATE_QUEUE}|${event.envelope.id}|${contentPublishedV1.type}`,
    ]);
  });

  it("never calls web for a duplicate: the inbox row absorbs the relay's second copy", async () => {
    const event = delivery();
    await handle(event);
    await expect(handle(event)).resolves.toEqual({ kind: "done" });
    expect(calls).toHaveLength(1);
    expect(await inboxRows()).toHaveLength(1);
  });

  it("retries a 503 and records nothing, so the next attempt calls web again", async () => {
    status = 503;
    const event = delivery();
    await expect(handle(event)).resolves.toEqual({ kind: "retry", reason: "web answered 503" });
    expect(await inboxRows()).toEqual([]);
    status = 204;
    await expect(handle(event)).resolves.toEqual({ kind: "done" });
    expect(calls).toHaveLength(2);
    expect(await inboxRows()).toHaveLength(1);
  });

  it("dead-letters a 401 (a wrong secret will not heal) and records nothing", async () => {
    status = 401;
    await expect(handle(delivery())).resolves.toEqual({ kind: "dead", reason: "web answered 401" });
    expect(await inboxRows()).toEqual([]);
  });

  it("records a concurrent duplicate's row once, without an error", async () => {
    const inbox = new RevalidationInbox(pool);
    const { envelope } = delivery();
    await Promise.all([
      inbox.record(REVALIDATE_QUEUE, envelope),
      inbox.record(REVALIDATE_QUEUE, envelope),
    ]);
    expect(await inboxRows()).toHaveLength(1);
    await expect(inbox.has(REVALIDATE_QUEUE, envelope.id)).resolves.toBe(true);
    await expect(inbox.has("another.queue", envelope.id)).resolves.toBe(false);
  });
});
