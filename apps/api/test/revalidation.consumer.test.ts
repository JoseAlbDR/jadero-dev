import {
  type CloudEventEnvelope,
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
  knowledgeSnapshotV1,
} from "@jadero/contracts";
import archived from "@jadero/contracts/fixtures/content.archived.v1.json" with { type: "json" };
import published from "@jadero/contracts/fixtures/content.published.v1.json" with { type: "json" };
import approved from "@jadero/contracts/fixtures/knowledge.entry.approved.v1.json" with {
  type: "json",
};
import withdrawn from "@jadero/contracts/fixtures/knowledge.entry.withdrawn.v1.json" with {
  type: "json",
};
import { InMemoryMessageBus } from "@jadero/messaging";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_CLEANUP_INTERVAL_MS,
  REVALIDATE_QUEUE,
  RevalidationConsumer,
} from "../src/modules/revalidation/revalidation.consumer.js";
import { RevalidationService } from "../src/modules/revalidation/revalidation.service.js";
import { FakeWebCache, InMemoryRevalidationInbox, recordingLogger } from "./revalidation.fakes.js";

/** Counts the cleanup statements run on the pool itself. */
class FakePool {
  readonly queries: string[] = [];
  async query(text: string) {
    this.queries.push(text.split(" ").slice(0, 3).join(" "));
    return { rows: [], rowCount: 0 };
  }
}

/** The consumer on the in-memory bus, with the real service over fakes. */
async function setup() {
  const bus = new InMemoryMessageBus({ retryTiersMs: [] });
  const web = new FakeWebCache();
  const pool = new FakePool();
  const service = new RevalidationService(
    new InMemoryRevalidationInbox(),
    web,
    recordingLogger().log,
  );
  const consumer = new RevalidationConsumer(bus, service, pool as unknown as Pool);
  consumer.onModuleInit();
  await consumer.onApplicationBootstrap();
  return { bus, web, pool, consumer };
}

/** Publishes a fixture envelope on its own routing key, as the relay would. */
async function publish(bus: InMemoryMessageBus, routingKey: string, envelope: unknown) {
  await bus.publish({ routingKey, envelope: envelope as CloudEventEnvelope });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RevalidationConsumer on the bus", () => {
  it("turns each of the four bound events into one call to web", async () => {
    const { bus, web, consumer } = await setup();
    await publish(bus, contentPublishedV1.routingKey, published);
    await publish(bus, contentArchivedV1.routingKey, archived);
    await publish(bus, knowledgeEntryApprovedV1.routingKey, approved);
    await publish(bus, knowledgeEntryWithdrawnV1.routingKey, withdrawn);
    await vi.waitFor(() => expect(web.calls).toHaveLength(4));
    expect(web.calls.map((c) => c.request.changes.map((change) => change.kind))).toEqual([
      ["project"],
      ["project", "project"],
      ["knowledge-entry"],
      ["knowledge-entry"],
    ]);
    expect(web.calls[0]?.traceparent).toBe(published.traceparent);
    await consumer.beforeApplicationShutdown();
    await bus.close();
  });

  it("is not bound to the snapshot, which waits for WP-20's consumer", async () => {
    const { bus, web, consumer } = await setup();
    await publish(bus, knowledgeSnapshotV1.routingKey, {
      ...published,
      type: knowledgeSnapshotV1.type,
    });
    expect(bus.unrouted()).toHaveLength(1);
    expect(web.calls).toEqual([]);
    await consumer.beforeApplicationShutdown();
    await bus.close();
  });

  it("dead-letters an archived project without a published slug", async () => {
    const { bus, web, consumer } = await setup();
    await publish(bus, contentArchivedV1.routingKey, {
      ...archived,
      data: { ...archived.data, slugs: {} },
    });
    await vi.waitFor(() => expect(bus.deadLetters(REVALIDATE_QUEUE)).toHaveLength(1));
    expect(bus.deadLetters(REVALIDATE_QUEUE)[0]?.reason).toBe(
      `no valid revalidation for ${contentArchivedV1.type}`,
    );
    expect(web.calls).toEqual([]);
    await consumer.beforeApplicationShutdown();
    await bus.close();
  });
});

describe("RevalidationConsumer lifecycle (inbox cleanup)", () => {
  it("cleans the inbox at startup and every day, until shutdown", async () => {
    vi.useFakeTimers();
    const { bus, pool, consumer } = await setup();
    expect(pool.queries).toEqual(["DELETE FROM messaging.inbox"]);
    await vi.advanceTimersByTimeAsync(INBOX_CLEANUP_INTERVAL_MS);
    expect(pool.queries).toHaveLength(2);
    await consumer.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INBOX_CLEANUP_INTERVAL_MS);
    expect(pool.queries).toHaveLength(2);
    await bus.close();
  });
});
