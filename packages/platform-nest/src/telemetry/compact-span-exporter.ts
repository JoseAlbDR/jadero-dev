import { SpanStatusCode } from "@opentelemetry/api";
import { core, type tracing } from "@opentelemetry/sdk-node";

/**
 * The only span attributes the compact exporter prints, with the short label it prints them
 * under. An allowlist on purpose: every other attribute (`url.full`, `url.query`, `db.statement`,
 * `messaging.url`, client addresses) can carry request data, query strings or credentials and
 * never reaches the terminal (AGENTS.md section 7). Old and stable semantic convention names are
 * both listed because the instrumentations do not all emit the same generation.
 */
export const COMPACT_SPAN_ATTRIBUTES: Readonly<Record<string, string>> = {
  "http.request.method": "method",
  "http.method": "method",
  "http.route": "route",
  "http.response.status_code": "status",
  "http.status_code": "status",
  "db.operation.name": "db",
  "db.operation": "db",
  "messaging.destination.name": "dest",
  "messaging.destination": "dest",
  "messaging.rabbitmq.destination.routing_key": "key",
  "messaging.rabbitmq.routing_key": "key",
  "messaging.operation": "op",
};

/** Longest attribute value printed; longer values are cut so a span stays one short line. */
const MAX_VALUE_LENGTH = 80;

/**
 * A development span exporter that prints one line per span instead of the ~56-line object of
 * the SDK's `ConsoleSpanExporter`: the first 8 hex of the trace id, the span name (indented when
 * the span has a local parent), the duration in milliseconds, `ERROR` when the span failed, and
 * the allowlisted attributes of {@link COMPACT_SPAN_ATTRIBUTES}. No resource block, no status
 * message (an error message can quote bound values). Selected with `OTEL_TRACES_EXPORTER=pretty`.
 *
 * It writes to stdout directly, not through pino: the exporter is built by the instrumentation
 * entry before Nest and its logger exist, and a span line is not a log event.
 */
export class CompactSpanExporter implements tracing.SpanExporter {
  private stopped = false;

  /**
   * @param write where each line goes; stdout by default, a test passes a collector.
   */
  constructor(
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {}

  /**
   * Prints each span as one line, then reports success; after shutdown it reports failure.
   * @param spans the ended spans of this batch.
   * @param resultCallback called once with the export result.
   */
  export(spans: tracing.ReadableSpan[], resultCallback: (result: core.ExportResult) => void): void {
    if (this.stopped) {
      resultCallback({ code: core.ExportResultCode.FAILED });
      return;
    }
    for (const span of spans) this.write(`${formatSpan(span)}\n`);
    resultCallback({ code: core.ExportResultCode.SUCCESS });
  }

  /**
   * Stops printing; later exports fail as the SpanExporter contract asks.
   * @returns a resolved promise, nothing is buffered.
   */
  shutdown(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  /**
   * Nothing to flush: every line is written as its span ends.
   * @returns a resolved promise.
   */
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Formats one span as the compact line, without the trailing newline.
 * @param span an ended span.
 * @returns for example `[span] 0af76519 GET 12ms method=GET route=/v1/content/profile status=200`.
 */
export function formatSpan(span: tracing.ReadableSpan): string {
  const traceId = span.spanContext().traceId.slice(0, 8);
  // A remote parent (a trace continued from a RabbitMQ header) still starts this process's tree.
  const child = span.parentSpanContext !== undefined && !span.parentSpanContext.isRemote;
  const parts = [
    "[span]",
    traceId,
    `${child ? "  " : ""}${span.name}`,
    `${Math.round(core.hrTimeToMilliseconds(span.duration))}ms`,
  ];
  if (span.status.code === SpanStatusCode.ERROR) parts.push("ERROR");
  const printed = new Set<string>();
  for (const [key, label] of Object.entries(COMPACT_SPAN_ATTRIBUTES)) {
    const value = span.attributes[key];
    if (value === undefined || printed.has(label)) continue;
    printed.add(label);
    parts.push(`${label}=${String(value).replace(/\s+/g, " ").slice(0, MAX_VALUE_LENGTH)}`);
  }
  return parts.join(" ");
}
