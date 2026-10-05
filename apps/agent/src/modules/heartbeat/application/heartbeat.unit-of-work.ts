import type { HeartbeatRepository } from "./heartbeat.repository.js";

/** The event fields the inbox keys and records. */
export interface InboxEvent {
  readonly id: string;
  readonly type: string;
}

/**
 * The consumer's inbox inside a unit of work (idempotent consumer, ADR-012): the row commits with
 * the consumer's effects or not at all, so a failed delivery is retried from scratch.
 */
export abstract class HeartbeatInbox {
  /**
   * Records that the consumer on `queue` applied `event`.
   * @param queue the consumer queue, part of the key so two consumers in one database stay independent.
   * @param event the event's id and type.
   * @returns true the first time, false for a duplicate delivery.
   */
  abstract record(queue: string, event: InboxEvent): Promise<boolean>;
}

/** What one unit of work of the heartbeat hands its work: everything bound to one transaction. */
export interface HeartbeatScope {
  readonly inbox: HeartbeatInbox;
  readonly heartbeats: HeartbeatRepository;
}

/**
 * The port for the heartbeat consumer's transaction boundary (unit of work, WP-10 D6 and Q2 B), an
 * abstract class so it is also the DI token (ADR-003). The adapter opens one transaction per `run`.
 */
export abstract class HeartbeatUnitOfWork {
  /**
   * Runs `work` in one transaction: commits when it resolves, rolls back and rethrows when it throws.
   * @param work the handler's writes, through the scope only.
   * @returns what `work` returned.
   */
  abstract run<T>(work: (scope: HeartbeatScope) => Promise<T>): Promise<T>;
}
