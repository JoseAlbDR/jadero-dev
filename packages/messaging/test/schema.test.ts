import { describe, expect, it } from "vitest";
import { messagingDdl } from "./support/messaging-ddl.js";

// The Drizzle schema must keep the shape WP-5's raw SQL created and the relay and inbox queries
// rely on (ADR-012): same columns, types, defaults and keys, and the partial index that keeps the
// relay's poll on unsent rows only.
describe("@jadero/messaging/schema", () => {
  it("generates the messaging schema, the outbox with its partial index, and the inbox", async () => {
    const ddl = (await messagingDdl()).map((statement) => statement.replace(/\s+/g, " ").trim());
    // drizzle-kit writes schemas, then tables, then indexes; the order inside a group follows the
    // export order, which does not matter.
    expect(ddl[0]).toBe('CREATE SCHEMA "messaging";');
    expect(ddl.slice(1, 3).sort()).toEqual([
      'CREATE TABLE "messaging"."inbox" ( "consumer" text NOT NULL, "event_id" uuid NOT NULL, "type" text NOT NULL, "received_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "inbox_pkey" PRIMARY KEY("consumer","event_id") );',
      'CREATE TABLE "messaging"."outbox" ( "id" uuid PRIMARY KEY NOT NULL, "type" text NOT NULL, "routing_key" text NOT NULL, "envelope" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "attempts" integer DEFAULT 0 NOT NULL, "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL, "last_error" text, "published_at" timestamp with time zone );',
    ]);
    expect(ddl.slice(3).sort()).toEqual([
      'CREATE INDEX "inbox_received_at" ON "messaging"."inbox" USING btree ("received_at");',
      'CREATE INDEX "outbox_unsent" ON "messaging"."outbox" USING btree ("next_attempt_at") WHERE "messaging"."outbox"."published_at" IS NULL;',
    ]);
  });
});
