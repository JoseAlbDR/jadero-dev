import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import type { z } from "zod";
import type { Delivery } from "../message-bus.js";
import { done, type HandlerOutcome } from "../outcome.js";
import { inTransaction, type SqlExecutor, type SqlPool } from "../sql/sql-executor.js";

/**
 * Records that `consumer` applied the event, in the caller's transaction (ADR-012, decision I1).
 * @param tx the consumer's open transaction.
 * @param consumer the consumer queue, part of the key so two consumers in one database stay independent.
 * @param envelope the event.
 * @returns true the first time, false when the event was already applied (a duplicate).
 */
export async function recordInInbox(
  tx: SqlExecutor,
  consumer: string,
  envelope: { id: string; type: string },
): Promise<boolean> {
  const { rows } = await tx.query(
    `INSERT INTO messaging.inbox (consumer, event_id, type) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [consumer, envelope.id, envelope.type],
  );
  return rows.length === 1;
}

/**
 * Wraps a consumer's effects in the idempotent-consumer pattern: one transaction holds the inbox
 * insert and the effects, so they commit together or not at all. A duplicate delivery finds its
 * row and skips the effects; an effect that throws rolls back the inbox row too, and the bus
 * retries it later from scratch.
 *
 * No app calls it today: apps write the inbox row with {@link recordInInbox} inside
 * platform-nest's `withTransaction`. It stays for this package's tests and as the reference shape;
 * it runs on `inTransaction`, which destroys the connection after every rollback (see there).
 * @param pool the consumer service's own database.
 * @param effects what the event does, inside the transaction.
 * @param onDuplicate called when a delivery was already applied (for a debug log line).
 * @returns a handler for `Subscription.handle`.
 */
export function idempotent<C extends EventContract<string, z.ZodType>>(
  pool: SqlPool,
  effects: (tx: SqlExecutor, delivery: Delivery<EnvelopeOf<C>>) => Promise<void>,
  onDuplicate?: (delivery: Delivery<EnvelopeOf<C>>) => void,
): (delivery: Delivery<EnvelopeOf<C>>) => Promise<HandlerOutcome> {
  return async (delivery) => {
    const first = await inTransaction(pool, async (tx) => {
      const isNew = await recordInInbox(tx, delivery.queue, delivery.envelope);
      if (isNew) await effects(tx, delivery);
      return isNew;
    });
    if (!first) onDuplicate?.(delivery);
    return done();
  };
}

/**
 * Deletes inbox rows older than the retention (WP-5 decision I1: 30 days). A replay older than
 * that is a human decision in WP-50.
 * @param executor a connection to the consumer service's database.
 * @param retentionMs how long to keep rows (default 30 days).
 * @returns how many rows were deleted.
 */
export async function cleanupInbox(
  executor: SqlExecutor,
  retentionMs = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const { rowCount } = await executor.query(
    "DELETE FROM messaging.inbox WHERE received_at < now() - make_interval(secs => $1)",
    [retentionMs / 1000],
  );
  return rowCount ?? 0;
}
