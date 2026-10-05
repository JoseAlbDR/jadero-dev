import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import { createEnvelope } from "@jadero/messaging";
import type { z } from "zod";
import { PingOutbox, type PingScope, PingUnitOfWork } from "../application/ping.unit-of-work.js";

/** An outbox that stages its envelopes until the unit of work commits them. */
class StagedOutbox extends PingOutbox {
  readonly staged: EnvelopeOf<EventContract<string, z.ZodType>>[] = [];

  /** {@inheritDoc PingOutbox.add} */
  async add<C extends EventContract<string, z.ZodType>>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>> {
    const envelope = createEnvelope(contract, data, "jadero/api");
    this.staged.push(envelope);
    return envelope;
  }
}

/**
 * The fake of {@link PingUnitOfWork} for unit tests (ADR-009: fakes at ports): the events a `run`
 * adds reach {@link outbox} only when its work resolves, and are discarded when it throws, the
 * same all-or-nothing a Postgres transaction gives.
 */
export class InMemoryPingUnitOfWork extends PingUnitOfWork {
  /** The committed outbox, oldest first. */
  readonly outbox: EnvelopeOf<EventContract<string, z.ZodType>>[] = [];

  /** {@inheritDoc PingUnitOfWork.run} */
  async run<T>(work: (scope: PingScope) => Promise<T>): Promise<T> {
    const staged = new StagedOutbox();
    const result = await work({ outbox: staged });
    this.outbox.push(...staged.staged);
    return result;
  }
}
