import "reflect-metadata";
import { AmqpConnection, Nack, RabbitMQModule, RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import type { INestApplicationContext } from "@nestjs/common";
import { Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same tag as infra/compose/compose.dev.yml, so dev and the test broker match.
const IMAGE = "rabbitmq:4.3.6-management-alpine";
const EXCHANGE = "spike.events";
const DLX = "spike.dlx";

type Event = { id: string; kind: string };

/** Collects what the handlers saw so the test can assert on it. */
const seen = { acked: [] as Event[], rejected: [] as Event[], deadLettered: [] as Event[] };

@Injectable()
class Handlers {
  /** Returning undefined: the library acks after the handler resolves. */
  @RabbitSubscribe({
    exchange: EXCHANGE,
    routingKey: "content.post.published.v1",
    queue: "spike.ok",
  })
  onPublished(msg: Event): void {
    seen.acked.push(msg);
  }

  /** Returning Nack(false): rejected without requeue, so the broker dead-letters it. */
  @RabbitSubscribe({
    exchange: EXCHANGE,
    routingKey: "content.post.rejected.v1",
    queue: "spike.reject",
    queueOptions: { deadLetterExchange: DLX, deadLetterRoutingKey: "dead" },
  })
  onRejected(msg: Event): Nack {
    seen.rejected.push(msg);
    return new Nack(false);
  }

  @RabbitSubscribe({ exchange: DLX, routingKey: "dead", queue: "spike.dlq" })
  onDead(msg: Event): void {
    seen.deadLettered.push(msg);
  }
}

function buildModule(uri: string) {
  @Module({
    imports: [
      RabbitMQModule.forRoot({
        uri,
        exchanges: [
          { name: EXCHANGE, type: "topic" },
          { name: DLX, type: "topic" },
        ],
        connectionInitOptions: { wait: true, timeout: 20_000 },
      }),
    ],
    providers: [Handlers],
  })
  class SpikeRabbitModule {}
  return SpikeRabbitModule;
}

describe("row 3: @golevelup/nestjs-rabbitmq on Nest 12 against a real broker", () => {
  let container: StartedRabbitMQContainer;
  let app: INestApplicationContext;

  beforeAll(async () => {
    container = await new RabbitMQContainer(IMAGE).start();
    app = await NestFactory.createApplicationContext(buildModule(container.getAmqpUrl()), {
      logger: ["error", "warn"],
    });
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it("publishes to a topic exchange with a publisher confirm and consumes with an ack", async () => {
    const amqp = app.get(AmqpConnection);
    // The managed channel is a confirm channel (amqp-connection-manager default): this promise
    // resolves only after the broker confirms the message.
    const confirmed = await amqp.publish(EXCHANGE, "content.post.published.v1", {
      id: "evt-1",
      kind: "published",
    });
    expect(confirmed).toBe(true);
    await vi.waitFor(() => expect(seen.acked).toEqual([{ id: "evt-1", kind: "published" }]), {
      timeout: 10_000,
    });
    // Acked: nothing left ready or unacked on the queue.
    const check = await amqp.channel.checkQueue("spike.ok");
    expect(check.messageCount).toBe(0);
  });

  it("a Nack(false) from the handler dead-letters the message", async () => {
    const amqp = app.get(AmqpConnection);
    await amqp.publish(EXCHANGE, "content.post.rejected.v1", { id: "evt-2", kind: "rejected" });
    await vi.waitFor(() => expect(seen.deadLettered).toEqual([{ id: "evt-2", kind: "rejected" }]), {
      timeout: 10_000,
    });
    expect(seen.rejected).toHaveLength(1);
  });
});
