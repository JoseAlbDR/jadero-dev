import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import type { z } from "zod";
import type { SqlExecutor } from "../sql/sql-executor.js";
import { createEnvelope } from "./envelope.js";

/**
 * Writes an event to the service's outbox inside the caller's transaction (transactional outbox,
 * ADR-012): the row commits with the state change or not at all, and the relay publishes it later.
 * Never publishes to the broker itself.
 * @param tx the executor of the caller's open transaction.
 * @param contract the event contract.
 * @param data the event's data, checked against the contract.
 * @param source the producing service, `jadero/<service>`.
 * @returns the envelope written, so the caller can return its id.
 */
export async function addToOutbox<C extends EventContract<string, z.ZodType>>(
  tx: SqlExecutor,
  contract: C,
  data: z.input<C["data"]>,
  source: string,
): Promise<EnvelopeOf<C>> {
  const envelope = createEnvelope(contract, data, source);
  await tx.query(
    "INSERT INTO messaging.outbox (id, type, routing_key, envelope) VALUES ($1, $2, $3, $4)",
    [envelope.id, envelope.type, contract.routingKey, JSON.stringify(envelope)],
  );
  return envelope;
}
