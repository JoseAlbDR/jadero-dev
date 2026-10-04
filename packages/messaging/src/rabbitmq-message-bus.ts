import { AmqpConnection } from "@golevelup/nestjs-rabbitmq";
import type { EventContract } from "@jadero/contracts";
import type { LoggerService } from "@nestjs/common";
import type { ChannelWrapper } from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import type { z } from "zod";
import { dispatch } from "./dispatch.js";
import { MessageBus, type OutgoingMessage, type Subscription } from "./message-bus.js";
import { DEFAULT_RETRY_TIERS_MS, dispose } from "./outcome.js";
import {
  ATTEMPT_HEADER,
  deadLetterQueueName,
  EVENTS_EXCHANGE,
  retryExchangeName,
  retryQueueName,
  serviceOfQueue,
} from "./topology/names.js";

/** Header with the reason a message was dead-lettered by its consumer (for WP-50's archive). */
export const DEAD_REASON_HEADER = "x-jadero-dead-reason";

/** Headers RabbitMQ adds when it dead-letters; a fresh copy starts without them. */
const BROKER_DEATH_HEADERS = /^x-(death|first-death-|last-death-)/;

/** Options of the RabbitMQ adapter. */
export interface RabbitMqMessageBusOptions {
  /** `amqp://<user>:<password>@<host>:<port>/<vhost>`: one user per service (ADR-029). */
  readonly uri: string;
  /** Unacknowledged deliveries per consumer (ADR-029: 10). */
  readonly prefetch?: number;
  /** How long a publish waits for the broker's confirm before it fails (default 5 s). */
  readonly publishTimeoutMs?: number;
  /** Retry delays; must match the wait queues in the topology. Defaults to 10 s, 1 min, 10 min. */
  readonly retryTiersMs?: readonly number[];
  /** How long a delivery is held before it is put back when its copy fails (default 1 s). */
  readonly redeliverDelayMs?: number;
  /** Where golevelup logs; Nest's logger shape, so `PinoLogger` fits. */
  readonly logger?: LoggerService;
}

type AnySubscription = Subscription<EventContract<string, z.ZodType>>;

/**
 * The RabbitMQ adapter of `MessageBus` (ADR-029). golevelup's `AmqpConnection` keeps the
 * connection and publishes with publisher confirms and a timeout; consumers run on their own
 * channel of the same connection, whose consumer tags survive reconnects. It declares nothing:
 * the topology comes from `definitions.json` and the service user has no `configure` right.
 *
 * Every delivery goes through the shared `dispatch` and `dispose` (WP-5 decisions P1, R1). A retry
 * is a copy, confirmed, through the service's retry exchange to the queue's wait queue, then an ack;
 * a dead outcome is a copy to the DLQ with the reason in a header, then an ack. Both copies go
 * through an exchange whose alternate exchange is `jadero.unrouted`, so a copy that matches no
 * queue is kept there, never lost. If a copy is not confirmed, the delivery is held for a moment
 * and put back: never acked without its copy, never requeued in a tight loop.
 * Connecting never blocks `start`: consumers attach when the broker is up.
 */
export class RabbitMqMessageBus extends MessageBus {
  private readonly connection: AmqpConnection;
  private readonly connected: Promise<void>;
  private readonly consumerChannel: ChannelWrapper;
  private readonly subscriptions = new Map<string, AnySubscription[]>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly retryTiersMs: readonly number[];
  private readonly publishTimeoutMs: number;
  private readonly redeliverDelayMs: number;
  private readonly prefetch: number;
  private consuming: Promise<unknown> | undefined;

  /** @param options the broker URI and the policy settings. */
  constructor(options: RabbitMqMessageBusOptions) {
    super();
    this.retryTiersMs = options.retryTiersMs ?? DEFAULT_RETRY_TIERS_MS;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 5000;
    this.redeliverDelayMs = options.redeliverDelayMs ?? 1000;
    this.prefetch = options.prefetch ?? 10;
    this.connection = new AmqpConnection({
      uri: options.uri,
      enableDirectReplyTo: false,
      registerHandlers: false,
      connectionInitOptions: { wait: false },
      ...(options.logger ? { logger: options.logger } : {}),
    });
    // init() resolves only once connected; the managed connection exists as soon as it is called.
    this.connected = this.connection.init();
    this.consumerChannel = this.connection.managedConnection.createChannel({ name: "consumers" });
  }

  /** @inheritdoc */
  override async publish(message: OutgoingMessage): Promise<void> {
    await this.send(
      EVENTS_EXCHANGE,
      message.routingKey,
      Buffer.from(JSON.stringify(message.envelope)),
      {
        messageId: message.envelope.id,
        headers: {},
      },
    );
  }

  /** @inheritdoc */
  override subscribe<C extends EventContract<string, z.ZodType>>(
    subscription: Subscription<C>,
  ): void {
    const list = this.subscriptions.get(subscription.queue) ?? [];
    list.push(subscription as unknown as AnySubscription);
    this.subscriptions.set(subscription.queue, list);
  }

  /** @inheritdoc Calling it while already consuming does nothing. */
  override async start(): Promise<void> {
    if (this.consuming) return;
    this.consuming = Promise.all(
      [...this.subscriptions.keys()].map((queue) =>
        this.consumerChannel.consume(queue, (raw) => this.track(this.consume(queue, raw)), {
          prefetch: this.prefetch,
        }),
      ),
    );
  }

  /**
   * Resolves once connected and every subscribed queue has a consumer. Tests and readiness use it;
   * `start` itself never waits for the broker.
   */
  async ready(): Promise<void> {
    await this.connected;
    await this.consumerChannel.waitForConnect();
    await this.consuming;
  }

  /** @returns whether the connection to the broker is up right now (for readiness). */
  isConnected(): boolean {
    return this.connection.connected;
  }

  /** @inheritdoc Cancels the consumers, then waits for the deliveries in progress. */
  override async stop(): Promise<void> {
    if (!this.consuming) return;
    this.consuming = undefined;
    await this.consumerChannel.cancelAll();
    await Promise.allSettled([...this.inFlight]);
  }

  /** @inheritdoc */
  override async close(): Promise<void> {
    await this.stop();
    await this.consumerChannel.close();
    await this.connection.close();
  }

  private track(work: Promise<void>): void {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  private async consume(queue: string, raw: ConsumeMessage): Promise<void> {
    const attempt = Number(raw.properties.headers?.[ATTEMPT_HEADER] ?? 1);
    let body: unknown;
    try {
      body = JSON.parse(raw.content.toString("utf8"));
    } catch {
      body = undefined;
    }
    const outcome = await dispatch(this.subscriptions.get(queue) ?? [], body, attempt, queue);
    const disposition = dispose(outcome, attempt, this.retryTiersMs);
    const retryExchange = retryExchangeName(serviceOfQueue(queue));
    const headers = copyHeaders(raw);
    try {
      if (disposition.action === "retry") {
        await this.send(retryExchange, retryQueueName(queue, disposition.delayMs), raw.content, {
          messageId: raw.properties.messageId,
          headers: { ...headers, [ATTEMPT_HEADER]: disposition.nextAttempt },
        });
      } else if (disposition.action === "dead-letter") {
        await this.send(retryExchange, deadLetterQueueName(queue), raw.content, {
          messageId: raw.properties.messageId,
          headers: {
            ...headers,
            [ATTEMPT_HEADER]: attempt,
            [DEAD_REASON_HEADER]: disposition.reason,
          },
        });
      }
      this.consumerChannel.ack(raw);
    } catch {
      // The copy was not confirmed (broker trouble). Hold the delivery, then put it back: a nack
      // does not count toward the quorum delivery limit on RabbitMQ 4.3, so without the pause this
      // would loop. The inbox makes the handler's second run harmless.
      await new Promise((resolve) => setTimeout(resolve, this.redeliverDelayMs));
      this.consumerChannel.nack(raw, false, true);
    }
  }

  private async send(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: { messageId: string | undefined; headers: Record<string, unknown> },
  ): Promise<void> {
    await this.connection.publish(exchange, routingKey, content, {
      contentType: "application/cloudevents+json",
      persistent: true,
      ...(options.messageId ? { messageId: options.messageId } : {}),
      headers: options.headers,
      // amqp-connection-manager waits forever for a confirm unless given a timeout.
      timeout: this.publishTimeoutMs,
    } as Parameters<AmqpConnection["publish"]>[3]);
  }
}

function copyHeaders(raw: ConsumeMessage): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw.properties.headers ?? {}).filter(
      ([name]) => !BROKER_DEATH_HEADERS.test(name),
    ),
  );
}
