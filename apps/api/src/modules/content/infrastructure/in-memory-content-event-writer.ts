import type { EnvelopeOf } from "@jadero/contracts";
import { createEnvelope } from "@jadero/messaging";
import type { z } from "zod";
import {
  CONTENT_EVENT_SOURCE,
  type ContentEventContract,
  ContentEventWriter,
  type WrittenContentEvent,
} from "../application/content-event-writer.js";

/**
 * The fake event writer (ADR-009): it builds and checks the envelope exactly like `addToOutbox`,
 * keeps it staged for one run, and hands it to the store's outbox only when the in-memory unit of
 * work commits; a run that throws drops it with the other staged writes. Passes the same contract
 * suite as `DrizzleContentEventWriter`.
 */
export class InMemoryContentEventWriter extends ContentEventWriter {
  private readonly staged: WrittenContentEvent[] = [];

  /** {@inheritDoc ContentEventWriter.write} */
  async write<C extends ContentEventContract>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>> {
    const envelope = createEnvelope(contract, data, CONTENT_EVENT_SOURCE);
    this.staged.push({ routingKey: contract.routingKey, envelope });
    return envelope;
  }

  /**
   * Appends the staged events to the outbox, in the order they were written. Called once, by the
   * unit of work's commit.
   * @param outbox the store's committed events.
   */
  commitTo(outbox: WrittenContentEvent[]): void {
    outbox.push(...this.staged);
  }
}
