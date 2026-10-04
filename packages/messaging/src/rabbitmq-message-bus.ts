import { AmqpConnection, MessageHandlerErrorBehavior, Nack } from "@golevelup/nestjs-rabbitmq";
import type { EventContract } from "@jadero/contracts";
import type { LoggerService } from "@nestjs/common";
import type { ConsumeMessage } from "amqplib";
import type { z } from "zod";
import { dispatch } from "./dispatch.js";
import { MessageBus, type OutgoingMessage, type Subscription } from "./message-bus.js";
import { DEFAULT_RETRY_TIERS_MS, dispose } from "./outcome.js";
import {
  ATTEMPT_HEADER,
  deadLetterQueueName,
  EVENTS_EXCHANGE,
  retryQueueName,
} from "./topology/names.js";

/** Header with the reason a message was dead-lettered by its consumer (for WP-50's archive). */
export const DEAD_REASON_HEADER = "x-jadero-dead-reason";

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
  /** Where golevelup and the adapter log; Nest's logger shape, so `PinoLogger` fits. */
  readonly logger?: LoggerService;
}

type AnySubscription = Subscription<EventContract<string, z.ZodType>>;

/**
 * The RabbitMQ adapter of `MessageBus`, over `@golevelup/nestjs-rabbitmq` (ADR-029). It declares
 * nothing: exchanges and queues come from `definitions.json` and the service user has no
 * `configure` right, so it only checks that its queues exist (WP-5 decision T4). Every publish
 * waits for the publisher confirm with a timeout. Consumers never use golevelup's error behavior:
 * the body is read as text and parsed here, the shared `dispatch` and `dispose` decide, and a retry
 * is a copy published to the queue's own wait queue followed by an ack (decision R1), so a failure
 * can never become a requeue loop. A dead outcome is a copy to the queue's DLQ with the reason in
 * a header, then an ack. Connecting does not block `start`: consumers attach when the broker is up.
 */
export class RabbitMqMessageBus extends MessageBus {
  private readonly connection: AmqpConnection;
  private readonly connected: Promise<void>;
  private readonly subscriptions = new Map<string, AnySubscription[]>();
  private readonly consumers = new Map<string, Promise<string>>();
  private readonly retryTiersMs: readonly number[];
  private readonly publishTimeoutMs: number;
  private stopped = false;

  /** @param options the broker URI and the policy settings. */
  constructor(options: RabbitMqMessageBusOptions) {
    super();
    this.retryTiersMs = options.retryTiersMs ?? DEFAULT_RETRY_TIERS_MS;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 5000;
    this.connection = new AmqpConnection({
      uri: options.uri,
      prefetchCount: options.prefetch ?? 10,
      enableDirectReplyTo: false,
      registerHandlers: false,
      // Only reached if our handler itself fails, which `dispatch` prevents; never requeue.
      defaultSubscribeErrorBehavior: MessageHandlerErrorBehavior.NACK,
      // The body stays text: a malformed one becomes a dead letter, not a deserializer crash.
      deserializer: (content: Buffer) => content.toString("utf8"),
      connectionInitOptions: { wait: false },
      ...(options.logger ? { logger: options.logger } : {}),
    });
    // init() resolves only once connected; the channels exist as soon as it is called.
    this.connected = this.connection.init();
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

  /** @inheritdoc */
  override async start(): Promise<void> {
    this.stopped = false;
    for (const queue of this.subscriptions.keys()) {
      const existing = this.consumers.get(queue);
      if (existing) {
        const resumed = existing.then(
          async (tag) => (await this.connection.resumeConsumer(tag)) ?? tag,
        );
        this.consumers.set(queue, resumed);
        continue;
      }
      this.consumers.set(
        queue,
        this.connection
          .createSubscriber<string>(
            (body, raw) => this.consume(queue, body, raw),
            {
              queue,
              createQueueIfNotExists: false,
            },
            queue,
          )
          .then(({ consumerTag }) => consumerTag),
      );
    }
  }

  /**
   * Resolves once connected and every subscribed queue has a consumer. Tests and readiness use it;
   * `start` itself never waits for the broker.
   */
  async ready(): Promise<void> {
    await this.connected;
    await Promise.all(this.consumers.values());
  }

  /** @returns whether the connection to the broker is up right now (for readiness). */
  isConnected(): boolean {
    return this.connection.connected;
  }

  /** @inheritdoc */
  override async stop(): Promise<void> {
    this.stopped = true;
    for (const consumer of this.consumers.values()) {
      await this.connection.cancelConsumer(await consumer);
    }
  }

  /** @inheritdoc */
  override async close(): Promise<void> {
    this.stopped = true;
    await this.connection.close();
  }

  private async consume(
    queue: string,
    text: string | undefined,
    raw?: ConsumeMessage,
  ): Promise<Nack | undefined> {
    if (!raw) return new Nack(false);
    const attempt = Number(raw.properties.headers?.[ATTEMPT_HEADER] ?? 1);
    let body: unknown;
    try {
      body = JSON.parse(text ?? "");
    } catch {
      body = undefined;
    }
    const outcome = await dispatch(this.subscriptions.get(queue) ?? [], body, attempt, queue);
    const disposition = dispose(outcome, attempt, this.retryTiersMs);
    try {
      if (disposition.action === "retry") {
        await this.send("", retryQueueName(queue, disposition.delayMs), raw.content, {
          messageId: raw.properties.messageId,
          headers: { ...raw.properties.headers, [ATTEMPT_HEADER]: disposition.nextAttempt },
        });
      } else if (disposition.action === "dead-letter") {
        await this.send("", deadLetterQueueName(queue), raw.content, {
          messageId: raw.properties.messageId,
          headers: {
            ...raw.properties.headers,
            [ATTEMPT_HEADER]: attempt,
            [DEAD_REASON_HEADER]: disposition.reason,
          },
        });
      }
      return undefined;
    } catch {
      // The copy was not confirmed (broker trouble): put the original back rather than lose it.
      // It is redelivered at once; the inbox makes a second run of the handler harmless.
      return this.stopped ? undefined : new Nack(true);
    }
  }

  private async send(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: { messageId: string | undefined; headers: Record<string, unknown> },
  ): Promise<void> {
    const confirmed = this.connection.publish(exchange, routingKey, content, {
      contentType: "application/cloudevents+json",
      persistent: true,
      ...(options.messageId ? { messageId: options.messageId } : {}),
      headers: options.headers,
      // amqp-connection-manager waits forever for a confirm unless given a timeout.
      timeout: this.publishTimeoutMs,
    } as Parameters<AmqpConnection["publish"]>[3]);
    await confirmed;
  }
}
