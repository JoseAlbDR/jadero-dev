import { z } from "zod";
import { cloudEventEnvelope, EVENT_TYPE_PREFIX, ROUTING_KEY } from "./envelope.js";

/**
 * One versioned event type: its routing key, its CloudEvents `type`, the schema of its `data`, and
 * the schema of the whole envelope with that `type` and `data`. Producers build envelopes that pass
 * `envelope`; consumers parse what they receive with it.
 */
export interface EventContract<K extends string, D extends z.ZodType> {
  /** The routing key on the `jadero.events` exchange, e.g. `system.ping.v1`. */
  readonly routingKey: K;
  /** The CloudEvents `type`, the routing key with the `dev.jadero.` prefix. */
  readonly type: `${typeof EVENT_TYPE_PREFIX}${K}`;
  /** The schema of `data` alone. */
  readonly data: D;
  /** The schema of the whole envelope: the base envelope with this `type` and this `data`. */
  readonly envelope: ReturnType<typeof envelopeFor<`${typeof EVENT_TYPE_PREFIX}${K}`, D>>;
}

function envelopeFor<T extends string, D extends z.ZodType>(type: T, data: D) {
  return cloudEventEnvelope.extend({ type: z.literal(type), data });
}

/**
 * Declares an event type. The version is part of the routing key: a breaking change is a new
 * contract (`...v2`) published next to the old one until every consumer moved (ADR-029 rule 4).
 * @param routingKey `<context>.<event>.v<N>`, lowercase.
 * @param data the Zod schema of the event's `data`; keep new fields optional.
 * @returns the contract with its routing key, type and schemas.
 * @throws Error when the routing key does not follow `<context>.<event>.v<N>`.
 */
export function defineEvent<const K extends string, D extends z.ZodType>(
  routingKey: K,
  data: D,
): EventContract<K, D> {
  if (!ROUTING_KEY.test(routingKey)) {
    throw new Error(`Routing key "${routingKey}" must look like <context>.<event>.v<N>`);
  }
  const type = `${EVENT_TYPE_PREFIX}${routingKey}` as const;
  return { routingKey, type, data, envelope: envelopeFor(type, data) };
}

/** The envelope type of a contract: `EnvelopeOf<typeof systemPingV1>`. */
export type EnvelopeOf<C extends EventContract<string, z.ZodType>> = z.infer<C["envelope"]>;
