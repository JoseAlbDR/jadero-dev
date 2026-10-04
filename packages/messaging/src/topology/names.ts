/** The topic exchange every event is published to (ADR-029). */
export const EVENTS_EXCHANGE = "jadero.events";
/** The direct exchange that receives rejected messages and routes them to `<queue>.dlq`. */
export const DEAD_LETTER_EXCHANGE = "jadero.dlx";
/** The alternate exchange of `jadero.events`, and its queue: messages no binding matched. */
export const UNROUTED = "jadero.unrouted";
/** The header carrying the delivery attempt on retried copies (`2` on the first retry). */
export const ATTEMPT_HEADER = "x-jadero-attempt";

/**
 * A short label for a retry delay, used in queue names: `10s`, `1m`, `10m`, `20ms` in tests.
 * @param delayMs the delay in milliseconds.
 * @returns the label.
 */
export function delayLabel(delayMs: number): string {
  if (delayMs % 60_000 === 0) return `${delayMs / 60_000}m`;
  if (delayMs % 1000 === 0) return `${delayMs / 1000}s`;
  return `${delayMs}ms`;
}

/**
 * @param queue the consumer queue.
 * @param delayMs the tier's delay.
 * @returns the wait queue of that tier, e.g. `agent.system.ping.retry.10s`.
 */
export function retryQueueName(queue: string, delayMs: number): string {
  return `${queue}.retry.${delayLabel(delayMs)}`;
}

/**
 * @param queue the consumer queue.
 * @returns its dead-letter queue, e.g. `agent.system.ping.dlq`.
 */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dlq`;
}
