import { type Attributes, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { core, type tracing } from "@opentelemetry/sdk-node";
import { describe, expect, it } from "vitest";
import { CompactSpanExporter, formatSpan } from "../src/telemetry/compact-span-exporter.js";

const traceId = "0af7651916cd43dd8448eb211c80319c";

/** A finished span with only the fields the exporter reads; the rest is never touched. */
function span(overrides: {
  name: string;
  attributes?: Attributes;
  parent?: { isRemote: boolean };
  error?: boolean;
  durationMs?: number;
}): tracing.ReadableSpan {
  const ms = overrides.durationMs ?? 12.4;
  return {
    name: overrides.name,
    kind: SpanKind.SERVER,
    spanContext: () => ({ traceId, spanId: "b7ad6b7169203331", traceFlags: 1 }),
    parentSpanContext: overrides.parent && {
      traceId,
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
      isRemote: overrides.parent.isRemote,
    },
    duration: [Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)],
    status: overrides.error
      ? { code: SpanStatusCode.ERROR, message: "duplicate key value (secret@example.com)" }
      : { code: SpanStatusCode.UNSET },
    attributes: overrides.attributes ?? {},
  } as unknown as tracing.ReadableSpan;
}

describe("formatSpan", () => {
  it("prints a root span on one line with the allowlisted http attributes", () => {
    const line = formatSpan(
      span({
        name: "GET /v1/content/profile",
        attributes: {
          "http.request.method": "GET",
          "http.route": "/v1/content/profile",
          "http.response.status_code": 200,
          "url.full": "http://localhost:3000/v1/content/profile?locale=en&token=abc",
          "url.query": "locale=en&token=abc",
          "client.address": "203.0.113.7",
          "user_agent.original": "curl/8.7.1",
        },
      }),
    );
    expect(line).toBe(
      "[span] 0af76519 GET /v1/content/profile 12ms method=GET route=/v1/content/profile status=200",
    );
  });

  it("indents a child span and prints the pg operation", () => {
    const line = formatSpan(
      span({
        name: "pg.query:SELECT content_dev",
        parent: { isRemote: false },
        durationMs: 2.6,
        attributes: { "db.operation.name": "SELECT", "db.query.text": "select * where email = $1" },
      }),
    );
    expect(line).toBe("[span] 0af76519   pg.query:SELECT content_dev 3ms db=SELECT");
  });

  it("treats a span continued from a remote parent as the root of this process", () => {
    const line = formatSpan(
      span({
        name: "dev.content process",
        parent: { isRemote: true },
        attributes: {
          "messaging.destination": "dev.content",
          "messaging.rabbitmq.routing_key": "content.published.v1",
          "messaging.url": "amqp://api:password@127.0.0.1:5672/dev",
        },
      }),
    );
    expect(line).toBe(
      "[span] 0af76519 dev.content process 12ms dest=dev.content key=content.published.v1",
    );
  });

  it("marks a failed span without its status message", () => {
    const line = formatSpan(span({ name: "pg.query:INSERT content_dev", error: true }));
    expect(line).toBe("[span] 0af76519 pg.query:INSERT content_dev 12ms ERROR");
  });

  it("keeps a multi-line or long value on one short line", () => {
    const line = formatSpan(
      span({ name: "x", attributes: { "http.route": `/a\n/b${"c".repeat(200)}` } }),
    );
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(140);
  });
});

describe("CompactSpanExporter", () => {
  it("writes one line per span and reports success", () => {
    const lines: string[] = [];
    const results: core.ExportResult[] = [];
    new CompactSpanExporter((line) => lines.push(line)).export(
      [span({ name: "GET" }), span({ name: "request handler - /x", parent: { isRemote: false } })],
      (result) => results.push(result),
    );
    expect(lines).toEqual([
      "[span] 0af76519 GET 12ms\n",
      "[span] 0af76519   request handler - /x 12ms\n",
    ]);
    expect(results).toEqual([{ code: core.ExportResultCode.SUCCESS }]);
  });

  it("fails exports after shutdown and writes nothing", async () => {
    const lines: string[] = [];
    const exporter = new CompactSpanExporter((line) => lines.push(line));
    await exporter.shutdown();
    let result: core.ExportResult | undefined;
    exporter.export([span({ name: "GET" })], (r) => {
      result = r;
    });
    expect(result?.code).toBe(core.ExportResultCode.FAILED);
    expect(lines).toEqual([]);
  });
});
