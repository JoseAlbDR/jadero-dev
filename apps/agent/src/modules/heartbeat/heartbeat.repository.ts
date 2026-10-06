import type { Database } from "@jadero/platform-nest";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { brokerHeartbeat } from "./infrastructure/heartbeat.schema.js";

/** One ping as `agent` records it. */
export interface HeartbeatRecord {
  readonly source: string;
  readonly eventId: string;
  readonly trigger: string;
  readonly seenAt: string;
}

/**
 * Writes `heartbeat.broker_heartbeat` through Drizzle. A plain class with no port: the heartbeat is
 * a layered module with no rules (ADR-003, WP-10 D5). It holds no connection; each call takes the
 * Drizzle instance of the caller's transaction, so the write commits with the inbox row.
 */
@Injectable()
export class HeartbeatRepository {
  /**
   * Upserts the last ping per source. Delivery order is not guaranteed (a retried or redelivered
   * ping can arrive after a newer one), so the update runs only when the stored ping is older:
   * `ON CONFLICT (source) DO UPDATE ... WHERE last_seen_at < excluded.last_seen_at`.
   * @param db Drizzle bound to the consumer's open transaction (`withTransaction`'s `db`).
   * @param record the ping.
   */
  async record(db: Database, record: HeartbeatRecord): Promise<void> {
    await db
      .insert(brokerHeartbeat)
      .values({
        source: record.source,
        lastEventId: record.eventId,
        lastTrigger: record.trigger,
        lastSeenAt: new Date(record.seenAt),
      })
      .onConflictDoUpdate({
        target: brokerHeartbeat.source,
        set: {
          lastEventId: sql.raw("excluded.last_event_id"),
          lastTrigger: sql.raw("excluded.last_trigger"),
          lastSeenAt: sql.raw("excluded.last_seen_at"),
        },
        setWhere: sql`${brokerHeartbeat.lastSeenAt} < excluded.last_seen_at`,
      });
  }
}
