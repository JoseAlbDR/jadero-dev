import { z } from "zod";
import type { EventContract } from "./define-event.js";
import { eventContracts } from "./events/index.js";

/** The exchange every event is published to (ADR-029). */
const EXCHANGE = "jadero.events";

function messageName(routingKey: string): string {
  return routingKey.replace(/[._]([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Builds the AsyncAPI 3.1 document that catalogs every event (ADR-029): one channel per routing key
 * on the `jadero.events` topic exchange, one message per event whose payload is the JSON Schema of
 * its whole CloudEvents envelope, generated from the Zod contract, so the catalog cannot drift from
 * the schemas. `asyncapi.json` is this output; a test fails when it is stale.
 * @param contracts the event contracts to catalog; every contract by default.
 * @returns the AsyncAPI document as a plain object, ready for `JSON.stringify`.
 */
export function buildAsyncApiDocument(
  contracts: readonly EventContract<string, z.ZodType>[] = eventContracts,
): Record<string, unknown> {
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};
  for (const contract of contracts) {
    const name = messageName(contract.routingKey);
    messages[name] = {
      name: contract.type,
      contentType: "application/cloudevents+json",
      payload: {
        schemaFormat: "application/schema+json;version=draft-07",
        schema: z.toJSONSchema(contract.envelope, { target: "draft-7", io: "input" }),
      },
    };
    channels[contract.routingKey] = {
      address: contract.routingKey,
      messages: { [name]: { $ref: `#/components/messages/${name}` } },
      bindings: {
        amqp: {
          is: "routingKey",
          exchange: { name: EXCHANGE, type: "topic", durable: true, autoDelete: false },
        },
      },
    };
    operations[`send${name.charAt(0).toUpperCase()}${name.slice(1)}`] = {
      action: "send",
      channel: { $ref: `#/channels/${contract.routingKey.replaceAll("/", "~1")}` },
    };
  }
  return {
    asyncapi: "3.1.0",
    info: {
      title: "jadero.dev events",
      version: "0.1.0",
      description:
        "Every event exchanged between the jadero.dev services through RabbitMQ. Generated from packages/contracts; do not edit by hand.",
    },
    defaultContentType: "application/cloudevents+json",
    channels,
    operations,
    components: { messages },
  };
}
