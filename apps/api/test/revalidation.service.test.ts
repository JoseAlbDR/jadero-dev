import { describe, expect, it } from "vitest";
import { RevalidationService } from "../src/modules/revalidation/revalidation.service.js";
import { FakeWebCache, InMemoryRevalidationInbox, recordingLogger } from "./revalidation.fakes.js";

const QUEUE = "api.revalidate";
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const CHANGES = [{ kind: "skill" as const, id: "0199f3a2-0000-7000-8000-000000000001" }];

/** The service over fakes, plus the fakes to assert on. */
function setup() {
  const web = new FakeWebCache();
  const inbox = new InMemoryRevalidationInbox();
  const { log, debug } = recordingLogger();
  return { web, inbox, debug, service: new RevalidationService(inbox, web, log) };
}

/** One delivery of an event with a fresh id. */
function delivery(traceparent?: string) {
  const envelope = {
    id: crypto.randomUUID(),
    type: "dev.jadero.content.published.v1",
    ...(traceparent ? { traceparent } : {}),
  };
  return { queue: QUEUE, envelope };
}

describe("RevalidationService: check, act, record (WP-14 D5)", () => {
  it("calls web, then records the event, then is done", async () => {
    const { web, inbox, service } = setup();
    const event = delivery();
    await expect(service.revalidate(event, CHANGES)).resolves.toEqual({ kind: "done" });
    expect(web.calls.map((c) => c.request)).toEqual([{ changes: CHANGES }]);
    expect(inbox.rows).toEqual(new Set([`${QUEUE}|${event.envelope.id}`]));
  });

  it("skips a duplicate without calling web, and logs it at debug with ids only", async () => {
    const { web, debug, service } = setup();
    const event = delivery();
    await service.revalidate(event, CHANGES);
    await expect(service.revalidate(event, CHANGES)).resolves.toEqual({ kind: "done" });
    expect(web.calls).toHaveLength(1);
    expect(debug).toEqual([
      [
        { event_id: event.envelope.id, type: event.envelope.type, queue: QUEUE },
        "duplicate ignored",
      ],
    ]);
  });

  it("retries a transient failure and records nothing, so the retry calls web again", async () => {
    const { web, inbox, service } = setup();
    web.answer({ kind: "transient", reason: "web answered 503" });
    const event = delivery();
    await expect(service.revalidate(event, CHANGES)).resolves.toEqual({
      kind: "retry",
      reason: "web answered 503",
    });
    expect(inbox.rows.size).toBe(0);
    await expect(service.revalidate(event, CHANGES)).resolves.toEqual({ kind: "done" });
    expect(web.calls).toHaveLength(2);
  });

  it("dead-letters a permanent failure and records nothing", async () => {
    const { web, inbox, service } = setup();
    web.answer({ kind: "permanent", reason: "web answered 401" });
    await expect(service.revalidate(delivery(), CHANGES)).resolves.toEqual({
      kind: "dead",
      reason: "web answered 401",
    });
    expect(inbox.rows.size).toBe(0);
  });

  it("dead-letters an event that maps to no valid call, without calling web", async () => {
    const { web, inbox, service } = setup();
    await expect(service.revalidate(delivery(), [])).resolves.toEqual({
      kind: "dead",
      reason: "no valid revalidation for dev.jadero.content.published.v1",
    });
    expect(web.calls).toEqual([]);
    expect(inbox.rows.size).toBe(0);
  });

  it("continues the producer's trace when no span is active", async () => {
    const { web, service } = setup();
    await service.revalidate(delivery(TRACEPARENT), CHANGES);
    await service.revalidate(delivery(), CHANGES);
    expect(web.calls.map((c) => c.traceparent)).toEqual([TRACEPARENT, undefined]);
  });
});
