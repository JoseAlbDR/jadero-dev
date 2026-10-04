import { isSpanContextValid, trace } from "@opentelemetry/api";

/**
 * The trace id of the span active right now (the HTTP request's, inside a handler or filter).
 * @returns the 32-hex-digit id, or undefined when telemetry is off or no span is active.
 */
export function currentTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}
