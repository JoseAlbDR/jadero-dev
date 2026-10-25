import type {
  CloudEventEnvelope,
  contentArchivedV1,
  contentPublishedV1,
  EnvelopeOf,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
} from "@jadero/contracts";
import type { z } from "zod";

/** The events the content module writes (WP-14 D3, Q2 A): its published language. */
export type ContentEventContract =
  | typeof contentPublishedV1
  | typeof contentArchivedV1
  | typeof knowledgeEntryApprovedV1
  | typeof knowledgeEntryWithdrawnV1;

/** The CloudEvents `source` of every content event: the producing service, not the process. */
export const CONTENT_EVENT_SOURCE = "jadero/api";

/** One event as the outbox holds it: the routing key the relay publishes with, and the envelope. */
export interface WrittenContentEvent {
  readonly routingKey: string;
  readonly envelope: CloudEventEnvelope;
}

/**
 * The port of the content module's integration events (WP-14 D1, ADR-012), an abstract class like
 * the repositories. A use case writes an event through the scope of its unit of work, so the event
 * commits with the state change it announces, or is discarded with it. The use case decides what to
 * emit from the domain's result; this port only stores it.
 */
export abstract class ContentEventWriter {
  /**
   * Adds one event to the outbox of the current unit of work. The data is checked against its
   * contract first, so a consumer never receives an event its schema rejects.
   * @param contract the event's contract from `@jadero/contracts`.
   * @param data the event's data.
   * @returns the envelope written; its `id` is the key a consumer's inbox records.
   * @throws {ZodError} when the data breaks the contract; nothing is written, and the run fails.
   */
  abstract write<C extends ContentEventContract>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>>;
}
