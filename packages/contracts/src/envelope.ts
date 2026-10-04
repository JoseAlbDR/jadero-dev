import { z } from "zod";

/**
 * A routing key, `<context>.<event>.v<N>` (ADR-029): lowercase words separated by dots, at least a
 * context and an event, then the version. `system.ping.v1`, `knowledge.entry.approved.v1`.
 */
export const ROUTING_KEY = /^[a-z]+(?:_[a-z]+)*(?:\.[a-z]+(?:_[a-z]+)*)+\.v[1-9][0-9]*$/;

/** The prefix that turns a routing key into a CloudEvents `type`: `dev.jadero.system.ping.v1`. */
export const EVENT_TYPE_PREFIX = "dev.jadero.";

/** A W3C trace context `traceparent`: version 00, a 32-hex trace id, a 16-hex span id, flags. */
export const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * The CloudEvents 1.0 envelope every message carries, in structured mode: this whole object is the
 * message body (WP-5 decision E1). `id` is the idempotency key the consumer's inbox records; `type`
 * names the event and its version; `traceparent` (the distributed tracing extension) carries the
 * trace of the request that wrote the outbox row. `data` is checked by each event's own schema.
 *
 * Unknown attributes are stripped, not rejected: a consumer must accept an envelope from a newer
 * producer that added an optional attribute (expand/contract, ADR-029 rule 4).
 */
export const cloudEventEnvelope = z.object({
  specversion: z.literal("1.0"),
  id: z.uuid(),
  source: z.string().regex(/^jadero\/[a-z][a-z0-9-]*$/),
  type: z.string().startsWith(EVENT_TYPE_PREFIX),
  time: z.iso.datetime({ offset: true }),
  datacontenttype: z.literal("application/json"),
  traceparent: z.string().regex(TRACEPARENT).optional(),
  tracestate: z.string().optional(),
  data: z.unknown(),
});

/** Any envelope, before its `data` is checked against an event's schema. */
export type CloudEventEnvelope = z.infer<typeof cloudEventEnvelope>;
