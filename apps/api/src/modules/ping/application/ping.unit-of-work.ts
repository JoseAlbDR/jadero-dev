import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import type { z } from "zod";

/**
 * `api`'s outbox inside a unit of work (ADR-012): `add` writes the event in the same transaction
 * as the rest of the work, so it commits with it or not at all. It takes no transaction argument:
 * the unit of work built it on its own connection (WP-10 Q2 B).
 */
export abstract class PingOutbox {
  /**
   * Adds an event to the outbox; the relay publishes it after the commit.
   * @param contract the event contract.
   * @param data the event's data, checked against the contract.
   * @returns the envelope written, so the caller can return its id.
   */
  abstract add<C extends EventContract<string, z.ZodType>>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>>;
}

/** What one unit of work of the ping hands its work: everything bound to one transaction. */
export interface PingScope {
  readonly outbox: PingOutbox;
}

/**
 * The port for the ping's transaction boundary (unit of work, WP-10 D6 and Q2 B), an abstract
 * class so it is also the DI token (ADR-003). The adapter opens one transaction per `run`.
 */
export abstract class PingUnitOfWork {
  /**
   * Runs `work` in one transaction: commits when it resolves, rolls back and rethrows when it throws.
   * @param work the use case's writes, through the scope only.
   * @returns what `work` returned.
   */
  abstract run<T>(work: (scope: PingScope) => Promise<T>): Promise<T>;
}
