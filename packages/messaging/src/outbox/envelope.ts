import { randomBytes } from "node:crypto";
import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import { context, propagation } from "@opentelemetry/api";
import type { z } from "zod";

/**
 * A UUIDv7: the first 48 bits are the Unix time in milliseconds, so ids sort by creation time and
 * index well, and the rest is random (RFC 9562). Generated in code because the envelope needs its
 * id before the outbox insert (WP-5 decision E1).
 * @param now the time to encode, in milliseconds.
 * @returns the UUID in its usual text form.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @returns the `traceparent` of the span active right now, or undefined when nothing is traced.
 */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

/**
 * Builds the envelope of an event and checks it against its contract, so a producer cannot write
 * an outbox row its consumers would reject. The `traceparent` of the current request is stored in
 * the envelope; the relay restores it when it publishes, so the trace continues (ADR-010).
 * @param contract the event contract.
 * @param data the event's data.
 * @param source the producing service, `jadero/<service>`.
 * @returns the validated envelope.
 * @throws ZodError when the data breaks the contract.
 */
export function createEnvelope<C extends EventContract<string, z.ZodType>>(
  contract: C,
  data: z.input<C["data"]>,
  source: string,
): EnvelopeOf<C> {
  const now = Date.now();
  const traceparent = currentTraceparent();
  return contract.envelope.parse({
    specversion: "1.0",
    id: uuidv7(now),
    source,
    type: contract.type,
    time: new Date(now).toISOString(),
    datacontenttype: "application/json",
    ...(traceparent ? { traceparent } : {}),
    data,
  }) as EnvelopeOf<C>;
}
