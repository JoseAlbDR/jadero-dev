import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import type { TelemetryEnv } from "./telemetry-env.js";

/**
 * Builds the OpenTelemetry SDK (WP-3 decision F1): an explicit list of instrumentations (http,
 * express, pg, pino; amqplib joins in WP-5), traces only. Nest controller spans are left out
 * (decision S2: `instrumentation-nestjs-core` does not declare Nest 12 yet).
 * @param env the validated telemetry variables.
 * @returns the SDK, not started; undefined when the exporter is `none`.
 */
export function createTelemetrySdk(env: TelemetryEnv): NodeSDK | undefined {
  if (env.OTEL_TRACES_EXPORTER === "none") return undefined;
  const spanProcessor =
    env.OTEL_TRACES_EXPORTER === "otlp"
      ? new tracing.BatchSpanProcessor(
          new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
        )
      : new tracing.SimpleSpanProcessor(new tracing.ConsoleSpanExporter());
  return new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    spanProcessors: [spanProcessor],
    // Without these, sdk-node starts OTLP metric and log exporters to :4318 on its own (spike row 6).
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      // Adds trace_id, span_id and trace_flags to every pino line; logs stay with pino.
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });
}
