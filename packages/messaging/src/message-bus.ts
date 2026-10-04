import type { CloudEventEnvelope, EnvelopeOf, EventContract } from "@jadero/contracts";
import type { z } from "zod";
import type { HandlerOutcome } from "./outcome.js";

/** A message on its way to the `jadero.events` exchange: the routing key and the whole envelope. */
export interface OutgoingMessage {
  /** The routing key, `<context>.<event>.v<N>`; the envelope's `type` without `dev.jadero.`. */
  readonly routingKey: string;
  /** The CloudEvents envelope, sent as the message body (structured mode, WP-5 decision E1). */
  readonly envelope: CloudEventEnvelope;
}

/** One delivery of an event to one consumer queue, already parsed with the contract. */
export interface Delivery<E> {
  /** The parsed envelope; `data` is typed by the contract. */
  readonly envelope: E;
  /** 1 on the first delivery, 2 after the first retry, and so on. */
  readonly attempt: number;
  /** The queue this delivery came from, e.g. `agent.system.ping`. */
  readonly queue: string;
}

/**
 * What a consumer registers: its queue, the event contract it accepts there, and the handler.
 * The handler returns an outcome and never acks itself (WP-5 decision P1); a thrown error counts as
 * `retry`. Handlers must be idempotent: delivery is at least once (ADR-012).
 */
export interface Subscription<C extends EventContract<string, z.ZodType>> {
  /** The consumer's queue, `<service>.<purpose>`, e.g. `agent.system.ping`. */
  readonly queue: string;
  /** The event version this handler understands; its routing key is the queue's binding. */
  readonly contract: C;
  /** Does the work and says how it went. */
  handle(delivery: Delivery<EnvelopeOf<C>>): Promise<HandlerOutcome>;
}

/**
 * The messaging port (ADR-003: ports are abstract classes, so this is also the DI token). Producers
 * never call it directly: they write to the outbox and the relay publishes (ADR-012). The adapter
 * owns acks, retries with growing delays, dead-lettering and unroutable messages, so every
 * consumer gets the same failure policy (WP-5 decisions P1 and R1).
 */
export abstract class MessageBus {
  /**
   * Publishes one message and resolves once the broker has accepted it (publisher confirm).
   * @param message the routing key and envelope.
   * @throws Error when the broker does not confirm in time; the relay retries the row later.
   */
  abstract publish(message: OutgoingMessage): Promise<void>;

  /**
   * Registers a consumer before `start`. A queue may carry several contracts (v1 and v2 during a
   * migration); each delivery goes to the subscription whose contract matches its `type`.
   * @param subscription the queue, contract and handler.
   */
  abstract subscribe<C extends EventContract<string, z.ZodType>>(
    subscription: Subscription<C>,
  ): void;

  /** Starts consuming every subscribed queue. */
  abstract start(): Promise<void>;

  /** Stops consuming; deliveries in progress finish first. */
  abstract stop(): Promise<void>;
}
