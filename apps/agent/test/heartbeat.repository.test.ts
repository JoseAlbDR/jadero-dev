import { drizzleOn } from "@jadero/platform-nest";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { HeartbeatRepository } from "../src/modules/heartbeat/heartbeat.repository.js";

/**
 * The SQL the repository sends, captured on a fake client. The behavior on real Postgres
 * (older never over newer) is proven by heartbeat.int.test.ts; this pins the statement's shape.
 */
describe("HeartbeatRepository (statement shape)", () => {
  it("upserts per source and updates only when the stored ping is older", async () => {
    const sent: { text: string; values: unknown[] }[] = [];
    const client = {
      query: async (query: { text: string }, values: unknown[]) => {
        sent.push({ text: query.text, values });
        return { rows: [], rowCount: 1, fields: [], command: "INSERT", oid: 0 };
      },
    } as unknown as PoolClient;
    await new HeartbeatRepository().record(drizzleOn(client), {
      source: "jadero/api",
      eventId: "0199a8b0-0000-7000-8000-000000000001",
      trigger: "heartbeat",
      seenAt: "2026-10-05T10:00:00.000Z",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(
      'insert into "heartbeat"."broker_heartbeat" ("source", "last_event_id", "last_trigger", "last_seen_at") ' +
        "values ($1, $2, $3, $4) " +
        'on conflict ("source") do update set "last_event_id" = excluded.last_event_id, ' +
        '"last_trigger" = excluded.last_trigger, "last_seen_at" = excluded.last_seen_at ' +
        'where "heartbeat"."broker_heartbeat"."last_seen_at" < excluded.last_seen_at',
    );
    expect(sent[0]?.values.slice(0, 3)).toEqual([
      "jadero/api",
      "0199a8b0-0000-7000-8000-000000000001",
      "heartbeat",
    ]);
  });
});
