import { z } from "zod";

/** The handler finished; the message is acknowledged and removed. */
export interface DoneOutcome {
  readonly kind: "done";
}
/** A transient failure: deliver again later, after the next retry tier. */
export interface RetryOutcome {
  readonly kind: "retry";
  readonly reason: string;
}
/** A permanent failure: retrying cannot help, send it to the dead-letter queue now. */
export interface DeadOutcome {
  readonly kind: "dead";
  readonly reason: string;
}
/** What a handler reports for one delivery. */
export type HandlerOutcome = DoneOutcome | RetryOutcome | DeadOutcome;

/** @returns the outcome for a handled message. */
export const done = (): DoneOutcome => ({ kind: "done" });
/**
 * @param reason why it failed, for the log line (never the message body).
 * @returns the outcome for a transient failure.
 */
export const retry = (reason: string): RetryOutcome => ({ kind: "retry", reason });
/**
 * @param reason why it can never succeed, for the log line and the dead-letter record.
 * @returns the outcome for a permanent failure.
 */
export const dead = (reason: string): DeadOutcome => ({ kind: "dead", reason });

/** The delays before the second, third and fourth attempt (ADR-029): 10 s, 1 min, 10 min. */
export const DEFAULT_RETRY_TIERS_MS = [10_000, 60_000, 600_000] as const;

/** What the adapter does with a delivery once its outcome is known. */
export type Disposition =
  | { readonly action: "ack" }
  | { readonly action: "retry"; readonly delayMs: number; readonly nextAttempt: number }
  | { readonly action: "dead-letter"; readonly reason: string };

/**
 * The failure policy every adapter applies, kept pure so it is tested once (WP-5 decision R1):
 * `done` acks; `retry` waits for the tier of this attempt and redelivers to the same queue only;
 * a `retry` after the last tier, or a `dead`, goes to the queue's dead-letter queue.
 * @param outcome what the handler reported.
 * @param attempt which delivery this was, starting at 1.
 * @param tiersMs the retry delays; their count is the number of retries.
 * @returns the disposition to carry out.
 */
export function dispose(
  outcome: HandlerOutcome,
  attempt: number,
  tiersMs: readonly number[] = DEFAULT_RETRY_TIERS_MS,
): Disposition {
  if (outcome.kind === "done") return { action: "ack" };
  if (outcome.kind === "dead") return { action: "dead-letter", reason: outcome.reason };
  const delayMs = tiersMs[attempt - 1];
  if (delayMs === undefined) {
    return {
      action: "dead-letter",
      reason: `retries exhausted after ${attempt} attempts: ${outcome.reason}`,
    };
  }
  return { action: "retry", delayMs, nextAttempt: attempt + 1 };
}

/** A delivery's attempt number: a whole number from 1 up. */
const attemptNumber = z.coerce.number().int().min(1);

/**
 * Reads the attempt header of a delivery (`x-jadero-attempt`), a boundary: the adapter writes it
 * as a number on every retry copy, but any publisher can set it. A missing or malformed value
 * (`"abc"`, `0`, `2.5`) counts as the first attempt, so the message gets its full retries instead
 * of `NaN` reaching `dispose`, which would dead-letter it at once as "retries exhausted after NaN
 * attempts".
 * @param header the raw header value, if any.
 * @returns the attempt number, starting at 1.
 */
export function attemptOf(header: unknown): number {
  const parsed = attemptNumber.safeParse(header);
  return parsed.success ? parsed.data : 1;
}
