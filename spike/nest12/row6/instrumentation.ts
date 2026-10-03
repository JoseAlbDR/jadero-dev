// Loaded with `node --import ./dist/row6/instrumentation.js` before the app's module graph.
import { register } from "node:module";
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";

// The ESM loader hook; it must be registered before the app's imports are evaluated.
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

if (process.env.SPIKE_OTEL_DIAG === "1") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const sdk = new NodeSDK({
  serviceName: "spike",
  spanProcessors: [new tracing.SimpleSpanProcessor(new tracing.ConsoleSpanExporter())],
  // Without these two, sdk-node 0.222 silently starts OTLP metric and log exporters to :4318.
  metricReaders: [],
  logRecordProcessors: [],
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PgInstrumentation(),
    new PinoInstrumentation({ disableLogSending: true }),
    new NestInstrumentation(),
  ],
});
sdk.start();

process.once("beforeExit", () => {
  void sdk.shutdown();
});
