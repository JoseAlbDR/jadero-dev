import type { WidgetRepository } from "./widget.repository.js";

/**
 * What a unit of work hands its work: repositories bound to one transaction. Only `widgets` here;
 * a module with a second write adds it to this scope (for example the outbox of an event, written
 * with `addToOutbox` on the same connection), so both commit together.
 */
export interface WidgetsScope {
  /** The widgets repository, bound to the transaction. */
  readonly widgets: WidgetRepository;
}

/**
 * The port of the module's transactions (unit of work, WP-10 D6 and Q2 B), an abstract class so it
 * is also the DI token (ADR-003). The use case owns the boundary (ADR-012): every write runs inside
 * `run`; a read that only displays data uses the constructor-injected repository, outside it.
 */
export abstract class WidgetsUnitOfWork {
  /**
   * Runs `work` as one transaction. Commits when `work` resolves; discards everything it wrote and
   * rethrows the same error when it throws. The scope's repositories are bound to the transaction:
   * use them, never the constructor-injected ones, for anything inside `work`.
   * @param work the use case's reads-for-writing and writes.
   * @returns what `work` returned, after the commit.
   */
  abstract run<T>(work: (scope: WidgetsScope) => Promise<T>): Promise<T>;
}
