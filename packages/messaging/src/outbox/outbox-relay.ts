import type { CloudEventEnvelope } from "@jadero/contracts";
import { context, propagation } from "@opentelemetry/api";
import { errorKind } from "../error-kind.js";
import type { MessageBus } from "../message-bus.js";
import { inTransaction, type SqlPool } from "../sql/sql-executor.js";

/** Structured logging, the shape pino's logger already has: fields first, then the message. */
export interface MessagingLog {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Options of the relay (WP-5 decision L1). */
export interface OutboxRelayOptions {
  readonly pool: SqlPool;
  readonly bus: MessageBus;
  readonly log?: MessagingLog;
  /** Rows claimed per poll (default 50). */
  readonly batchSize?: number;
  /** Pause between polls (default 1 s). */
  readonly intervalMs?: number;
  /** How long published rows are kept (default 7 days). */
  readonly retentionMs?: number;
}

/** What one poll did. */
export interface RelayRun {
  readonly published: number;
  readonly failed: number;
}

interface OutboxRow {
  id: string;
  routing_key: string;
  envelope: CloudEventEnvelope;
  attempts: number;
}

/**
 * The delay before the next attempt of a row that failed `attempts` times: 1 s doubling, at most
 * 60 s. A broker outage then costs one cheap query per row per minute, not a hot loop.
 * @param attempts failed attempts so far, after this failure.
 * @returns the delay in seconds.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

/**
 * The message relay of one service (ADR-012; it runs in `api-worker` for `api`). Each poll claims
 * up to 50 due rows with `FOR UPDATE SKIP LOCKED` (a second relay skips them instead of waiting),
 * publishes each with the request's trace context restored (ADR-010, decision E1), waits for the
 * broker's confirm, and marks it published in the same transaction. A row whose publish fails gets
 * its attempt counted and a later `next_attempt_at`; the others still go out. A crash after a
 * confirm and before the commit publishes the row again on the next poll: at-least-once, which
 * the consumers' inbox absorbs.
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly retentionMs: number;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private active = false;

  /** @param options the pool, the bus and the polling settings. */
  constructor(private readonly options: OutboxRelayOptions) {
    this.batchSize = options.batchSize ?? 50;
    this.intervalMs = options.intervalMs ?? 1000;
    this.retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Claims and publishes one batch.
   * @returns how many rows were published and how many failed.
   */
  async runOnce(): Promise<RelayRun> {
    return inTransaction(this.options.pool, async (tx) => {
      const { rows } = await tx.query<OutboxRow>(
        `SELECT id, routing_key, envelope, attempts FROM messaging.outbox
          WHERE published_at IS NULL AND next_attempt_at <= now()
          ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );
      const published: string[] = [];
      let failed = 0;
      for (const row of rows) {
        try {
          const parent = propagation.extract(context.active(), {
            traceparent: row.envelope.traceparent ?? "",
          });
          await context.with(parent, () =>
            this.options.bus.publish({ routingKey: row.routing_key, envelope: row.envelope }),
          );
          published.push(row.id);
        } catch (error) {
          failed += 1;
          const attempts = row.attempts + 1;
          await tx.query(
            `UPDATE messaging.outbox SET attempts = $2, last_error = $3,
                    next_attempt_at = now() + make_interval(secs => $4) WHERE id = $1`,
            [row.id, attempts, errorKind(error), backoffSeconds(attempts)],
          );
          this.options.log?.warn(
            { event_id: row.id, routing_key: row.routing_key, attempts, error: errorKind(error) },
            "outbox publish failed",
          );
        }
      }
      if (published.length > 0) {
        await tx.query(
          "UPDATE messaging.outbox SET published_at = now() WHERE id = ANY($1::uuid[])",
          [published],
        );
        this.options.log?.debug({ count: published.length }, "outbox rows published");
      }
      return { published: published.length, failed };
    });
  }

  /**
   * Deletes published rows older than the retention (ADR-012: outbox cleanup in each relay).
   * @returns how many rows were deleted.
   */
  async cleanup(): Promise<number> {
    const client = await this.options.pool.connect();
    try {
      const { rowCount } = await client.query(
        "DELETE FROM messaging.outbox WHERE published_at < now() - make_interval(secs => $1)",
        [this.retentionMs / 1000],
      );
      return rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  /** Starts polling: one batch, a pause, the next batch. An error in one poll is logged, not fatal. */
  start(): void {
    if (this.active) return;
    this.active = true;
    const tick = () => {
      this.running = this.runOnce()
        .catch((error) => this.options.log?.warn({ error: errorKind(error) }, "outbox poll failed"))
        .finally(() => {
          if (this.active) this.timer = setTimeout(tick, this.intervalMs);
        });
    };
    tick();
  }

  /** Stops polling and waits for the batch in progress. */
  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
