import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config/load-config.js";
import { ProblemDetailsFilter } from "../src/errors/problem-details.filter.js";
import { createTelemetrySdk } from "../src/telemetry/create-sdk.js";
import { telemetryEnv } from "../src/telemetry/telemetry-env.js";
import { currentTraceId } from "../src/telemetry/trace-id.js";

describe("telemetryEnv", () => {
  it("defaults to the console exporter", () => {
    expect(parseConfig(telemetryEnv, { OTEL_SERVICE_NAME: "api" })).toEqual({
      OTEL_SERVICE_NAME: "api",
      OTEL_TRACES_EXPORTER: "console",
    });
  });

  it("requires an endpoint for otlp, naming the variable", () => {
    expect(() =>
      parseConfig(telemetryEnv, { OTEL_SERVICE_NAME: "api", OTEL_TRACES_EXPORTER: "otlp" }),
    ).toThrow(ConfigError);
    try {
      parseConfig(telemetryEnv, { OTEL_SERVICE_NAME: "api", OTEL_TRACES_EXPORTER: "otlp" });
    } catch (error) {
      expect((error as ConfigError).issues[0]?.variable).toBe("OTEL_EXPORTER_OTLP_ENDPOINT");
    }
  });
});

describe("createTelemetrySdk", () => {
  it("builds no SDK for none and an unstarted SDK otherwise", () => {
    expect(
      createTelemetrySdk({ OTEL_SERVICE_NAME: "api", OTEL_TRACES_EXPORTER: "none" }),
    ).toBeUndefined();
    expect(
      createTelemetrySdk({ OTEL_SERVICE_NAME: "api", OTEL_TRACES_EXPORTER: "console" }),
    ).toBeInstanceOf(NodeSDK);
  });
});

describe("trace id in problem details", () => {
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const manager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(manager.enable());
    Logger.overrideLogger(false); // the filter logs the 500; not needed here
  });

  afterAll(() => {
    manager.disable();
    context.disable();
    Logger.overrideLogger(true);
  });

  it("is absent without an active span and present inside one", () => {
    expect(currentTraceId()).toBeUndefined();
    const span = trace.wrapSpanContext({ traceId, spanId: "b7ad6b7169203331", traceFlags: 1 });
    context.with(trace.setSpan(context.active(), span), () => {
      expect(currentTraceId()).toBe(traceId);
      let sent: Record<string, unknown> = {};
      const response = {
        status: () => response,
        type: () => response,
        json: (body: Record<string, unknown>) => {
          sent = body;
        },
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ url: "/x", id: "req-12345678" }),
          getResponse: () => response,
        }),
      };
      new ProblemDetailsFilter().catch(new Error("boom"), host as never);
      expect(sent).toMatchObject({ status: 500, requestId: "req-12345678", traceId });
    });
  });
});

describe("instrumentation entry (built dist, real node --import)", () => {
  it("patches http and pino: a request becomes a span and the log line carries its trace_id", () => {
    const entry = fileURLToPath(new URL("../dist/telemetry/instrumentation.js", import.meta.url));
    const fixture = fileURLToPath(new URL("./fixtures/otel-smoke.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--import", entry, fixture], {
      env: { PATH: process.env.PATH, OTEL_SERVICE_NAME: "smoke", OTEL_TRACES_EXPORTER: "console" },
      encoding: "utf8",
      timeout: 20_000,
    });
    const logLine = JSON.parse(
      output.split("\n").find((line) => line.includes('"msg":"handled"')) ?? "{}",
    );
    expect(logLine.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(output).toContain(`traceId: '${logLine.trace_id}'`);
    expect(output).toContain("name: 'GET'");
  });

  it("refuses to start with an invalid telemetry config, naming the variable", () => {
    const entry = fileURLToPath(new URL("../dist/telemetry/instrumentation.js", import.meta.url));
    const run = () =>
      execFileSync(process.execPath, ["--import", entry, "-e", "0"], {
        env: { PATH: process.env.PATH, OTEL_SERVICE_NAME: "smoke", OTEL_TRACES_EXPORTER: "otlp" },
        encoding: "utf8",
        stdio: "pipe",
      });
    expect(run).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT: required when OTEL_TRACES_EXPORTER is otlp/);
  });
});
