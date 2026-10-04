import type { SqlExecutor } from "@jadero/messaging";
import { Injectable } from "@nestjs/common";

/** One ping as `agent` records it. */
export interface HeartbeatRecord {
  readonly source: string;
  readonly eventId: string;
  readonly trigger: string;
  readonly seenAt: string;
}

/** Writes `broker_heartbeat`, in the transaction the inbox opened (idempotent consumer). */
@Injectable()
export class HeartbeatRepository {
  /**
   * Upserts the last ping per source.
   * @param tx the consumer's open transaction.
   * @param record the ping.
   */
  async record(tx: SqlExecutor, record: HeartbeatRecord): Promise<void> {
    await tx.query(
      `INSERT INTO broker_heartbeat (source, last_event_id, last_trigger, last_seen_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source) DO UPDATE
         SET last_event_id = EXCLUDED.last_event_id, last_trigger = EXCLUDED.last_trigger,
             last_seen_at = EXCLUDED.last_seen_at`,
      [record.source, record.eventId, record.trigger, record.seenAt],
    );
  }
}
