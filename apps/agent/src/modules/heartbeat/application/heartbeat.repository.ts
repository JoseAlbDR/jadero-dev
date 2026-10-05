/** One ping as `agent` records it. */
export interface HeartbeatRecord {
  readonly source: string;
  readonly eventId: string;
  readonly trigger: string;
  readonly seenAt: string;
}

/**
 * The port for `agent`'s read model of the ping, an abstract class (ADR-003). Inside a unit of work
 * it comes bound to the transaction, so it takes no connection argument (WP-10 Q2 B).
 */
export abstract class HeartbeatRepository {
  /**
   * Keeps the last ping per source. Delivery order is not guaranteed (a retried or redelivered
   * ping can arrive after a newer one), so an older ping never overwrites a newer one.
   * @param record the ping.
   */
  abstract record(record: HeartbeatRecord): Promise<void>;
}
