import type { CloudEventEnvelope, EventContract } from "@jadero/contracts";
import type { z } from "zod";
import { dispatch } from "./dispatch.js";
import { MessageBus, type OutgoingMessage, type Subscription } from "./message-bus.js";
import { DEFAULT_RETRY_TIERS_MS, dispose } from "./outcome.js";
import { topicMatches } from "./topic.js";

/** A message that reached a dead-letter queue, with why and after how many attempts. */
export interface DeadLetter {
  readonly envelope: unknown;
  readonly reason: string;
  readonly attempts: number;
}

interface Queued {
  readonly body: unknown;
  readonly attempt: number;
}

interface QueueState {
  readonly subscriptions: Subscription<EventContract<string, z.ZodType>>[];
  readonly waiting: Queued[];
  readonly deadLetters: DeadLetter[];
  busy: boolean;
}

/** Options of the in-memory bus. */
export interface InMemoryMessageBusOptions {
  /** Retry delays; tests pass short ones. Defaults to 10 s, 1 min, 10 min. */
  readonly retryTiersMs?: readonly number[];
}

/**
 * The in-memory adapter of `MessageBus`, for unit tests of producers and consumers (ADR-029). It
 * follows the RabbitMQ topology's behavior: topic bindings from each subscription's routing key,
 * one queue per consumer that buffers while stopped, one delivery at a time per queue, the same
 * retry tiers and dead-lettering, and unroutable messages kept aside. Every message is copied
 * through JSON, as the wire would, so a handler never shares an object with the producer.
 */
export class InMemoryMessageBus extends MessageBus {
  private readonly queues = new Map<string, QueueState>();
  private readonly unroutedMessages: OutgoingMessage[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly retryTiersMs: readonly number[];
  private started = false;

  /** @param options retry tiers; the defaults match production. */
  constructor(options: InMemoryMessageBusOptions = {}) {
    super();
    this.retryTiersMs = options.retryTiersMs ?? DEFAULT_RETRY_TIERS_MS;
  }

  /** @inheritdoc */
  override async publish(message: OutgoingMessage): Promise<void> {
    const targets = [...this.queues.values()].filter((queue) =>
      queue.subscriptions.some((s) => topicMatches(s.contract.routingKey, message.routingKey)),
    );
    if (targets.length === 0) {
      this.unroutedMessages.push(structuredClone(message));
      return;
    }
    for (const queue of targets) this.enqueue(queue, { body: wire(message.envelope), attempt: 1 });
  }

  /** @inheritdoc */
  override subscribe<C extends EventContract<string, z.ZodType>>(
    subscription: Subscription<C>,
  ): void {
    let queue = this.queues.get(subscription.queue);
    if (!queue) {
      queue = { subscriptions: [], waiting: [], deadLetters: [], busy: false };
      this.queues.set(subscription.queue, queue);
    }
    queue.subscriptions.push(
      subscription as unknown as Subscription<EventContract<string, z.ZodType>>,
    );
  }

  /** @inheritdoc */
  override async start(): Promise<void> {
    this.started = true;
    for (const [name, queue] of this.queues) void this.drain(name, queue);
  }

  /** @inheritdoc */
  override async stop(): Promise<void> {
    this.started = false;
    while ([...this.queues.values()].some((q) => q.busy)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * @param queue the consumer queue.
   * @returns what reached that queue's dead-letter queue, oldest first.
   */
  deadLetters(queue: string): readonly DeadLetter[] {
    return this.queues.get(queue)?.deadLetters ?? [];
  }

  /** @returns messages no binding matched (the alternate exchange's queue in RabbitMQ). */
  unrouted(): readonly OutgoingMessage[] {
    return this.unroutedMessages;
  }

  /** Clears pending retry timers, so a test run can end. */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private enqueue(queue: QueueState, item: Queued): void {
    queue.waiting.push(item);
    const name = [...this.queues].find(([, q]) => q === queue)?.[0];
    if (this.started && name) void this.drain(name, queue);
  }

  private async drain(name: string, queue: QueueState): Promise<void> {
    if (queue.busy) return;
    queue.busy = true;
    try {
      while (this.started) {
        const item = queue.waiting.shift();
        if (!item) break;
        const outcome = await dispatch(queue.subscriptions, item.body, item.attempt, name);
        const disposition = dispose(outcome, item.attempt, this.retryTiersMs);
        if (disposition.action === "retry") {
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            this.enqueue(queue, { body: item.body, attempt: disposition.nextAttempt });
          }, disposition.delayMs);
          this.timers.add(timer);
        } else if (disposition.action === "dead-letter") {
          queue.deadLetters.push({
            envelope: item.body,
            reason: disposition.reason,
            attempts: item.attempt,
          });
        }
      }
    } finally {
      queue.busy = false;
    }
  }
}

function wire(envelope: CloudEventEnvelope): unknown {
  return JSON.parse(JSON.stringify(envelope));
}
