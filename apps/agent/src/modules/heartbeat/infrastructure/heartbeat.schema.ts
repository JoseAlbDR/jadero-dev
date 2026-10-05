import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// agent's read model of the ping (WP-5): when the messaging path last worked, per source. A future
// lag signal for WP-26 and the Under the hood page. Owned by agent; no other service reads it.
// Lives in the `heartbeat` Postgres schema, named after its module (WP-10 "Postgres schema per
// module"). Never exported from the module's index.ts, so other modules cannot reach the table.

/**
 * The `heartbeat` Postgres schema. Exported because drizzle-kit writes `CREATE SCHEMA` only for a
 * schema value it finds among a config's exports.
 */
export const heartbeat = pgSchema("heartbeat");

/** The last ping seen per source. */
export const brokerHeartbeat = heartbeat.table("broker_heartbeat", {
  /** The event's CloudEvents source, e.g. `jadero/api`. */
  source: text().primaryKey(),
  lastEventId: uuid().notNull(),
  /** `manual` or `heartbeat`. */
  lastTrigger: text().notNull(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull(),
});
