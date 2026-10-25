import type { EnvelopeOf } from "@jadero/contracts";
import { addToOutbox } from "@jadero/messaging";
import type { QueryExecutor } from "@jadero/platform-nest";
import type { z } from "zod";
import {
  CONTENT_EVENT_SOURCE,
  type ContentEventContract,
  ContentEventWriter,
} from "../application/content-event-writer.js";

/**
 * The real event writer (WP-14 D1, ADR-012): `addToOutbox` inserts the envelope into
 * `messaging.outbox` on the executor of the unit of work's transaction, never on the pool, so the
 * row commits with the publish and disappears with its rollback. The relay in `api-worker`
 * publishes it later; `api` never talks to the broker.
 */
export class DrizzleContentEventWriter extends ContentEventWriter {
  /** @param executor the raw executor of the transaction `withTransaction` opened. */
  constructor(private readonly executor: QueryExecutor) {
    super();
  }

  /** {@inheritDoc ContentEventWriter.write} */
  write<C extends ContentEventContract>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>> {
    return addToOutbox(this.executor, contract, data, CONTENT_EVENT_SOURCE);
  }
}
