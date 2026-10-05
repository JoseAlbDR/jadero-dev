import type { Database } from "@jadero/platform-nest";
import { sql } from "drizzle-orm";
import { type HeartbeatRecord, HeartbeatRepository } from "../application/heartbeat.repository.js";
import { brokerHeartbeat } from "./heartbeat.schema.js";

/** Writes `heartbeat.broker_heartbeat` through Drizzle, on the connection it was built with. */
export class DrizzleHeartbeatRepository extends HeartbeatRepository {
  /** @param db Drizzle bound to the unit of work's transaction. */
  constructor(private readonly db: Database) {
    super();
  }

  /**
   * Upserts the last ping per source. Delivery order is not guaranteed (a retried or redelivered
   * ping can arrive after a newer one), so the update runs only when the stored ping is older:
   * `ON CONFLICT (source) DO UPDATE ... WHERE last_seen_at < excluded.last_seen_at`.
   * @param record the ping.
   */
  async record(record: HeartbeatRecord): Promise<void> {
    await this.db
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
