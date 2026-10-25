import { recordInInbox } from "@jadero/messaging";
import { PG_POOL } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";

/**
 * The revalidation consumer's view of `messaging.inbox` (ADR-012), in `api`'s own database. A plain
 * class with no port (a layered module, ADR-003); each method runs one statement on the pool and
 * holds no transaction, because the effect between the check and the record is an HTTP call
 * (WP-14 D5: a pooled connection never waits on web).
 */
@Injectable()
export class RevalidationInbox {
  /** @param pool `api`'s pool from `DatabaseModule`. */
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * @param consumer the queue, part of the inbox key.
   * @param eventId the event's envelope id.
   * @returns whether this consumer already handled the event.
   */
  async has(consumer: string, eventId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "SELECT 1 FROM messaging.inbox WHERE consumer = $1 AND event_id = $2",
      [consumer, eventId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Records the event as handled, after its effect; a concurrent duplicate that got there first
   * is no error (`ON CONFLICT DO NOTHING`).
   * @param consumer the queue, part of the inbox key.
   * @param envelope the event's id and type.
   */
  async record(consumer: string, envelope: { id: string; type: string }): Promise<void> {
    await recordInInbox(this.pool, consumer, envelope);
  }
}
