import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The outbox and inbox as Drizzle tables (ADR-012; WP-10 Q1 A), published as
// `@jadero/messaging/schema`. Each service's drizzle.config.ts includes only the tables it uses, so
// `db:generate` writes their DDL into that service's own migrations, applied to its own database
// (ADR-029 rule 1). Infrastructure tables only: a business table here would be a shared kernel.
// This is the only file in the package that imports drizzle-orm (dependency-cruiser
// `messaging-drizzle-only-in-schema`); the relay and the inbox keep their raw SQL (WP-5).
// Column names come from the keys through `casing: "snake_case"`, which every service sets.

/**
 * The `messaging` Postgres schema. Exported because drizzle-kit writes `CREATE SCHEMA` only for a
 * schema value it finds among a config's exports.
 */
export const messaging = pgSchema("messaging");

/** One row per event to publish, inserted in the same transaction as the state change. */
export const outbox = messaging.table(
  "outbox",
  {
    /** The CloudEvents id. */
    id: uuid().primaryKey(),
    /** `dev.jadero.<context>.<event>.v<N>`. */
    type: text().notNull(),
    /** `<context>.<event>.v<N>`. */
    routingKey: text().notNull(),
    /** The whole envelope, exactly what goes on the wire. */
    envelope: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Failed publish attempts. */
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Error class and code only, never a message. */
    lastError: text(),
    publishedAt: timestamp({ withTimezone: true }),
  },
  // Keeps the relay's poll cheap: only unsent rows are indexed.
  (t) => [index("outbox_unsent").on(t.nextAttemptAt).where(sql`${t.publishedAt} IS NULL`)],
);

/** One row per event a consumer has applied, inserted in the same transaction as its effects. */
export const inbox = messaging.table(
  "inbox",
  {
    /** The consumer queue, e.g. `agent.system.ping`. */
    consumer: text().notNull(),
    eventId: uuid().notNull(),
    type: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // `inbox_pkey` is the name Postgres gives a primary key by default, as WP-5's SQL had it.
  (t) => [
    primaryKey({ name: "inbox_pkey", columns: [t.consumer, t.eventId] }),
    index("inbox_received_at").on(t.receivedAt),
  ],
);
