import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExpressInstrumentation, ExpressLayerType } from "@opentelemetry/instrumentation-express";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigError, parseConfig } from "../src/config/load-config.js";
import { ProblemDetailsFilter } from "../src/errors/problem-details.filter.js";
import { createTelemetrySdk, telemetryInstrumentations } from "../src/telemetry/create-sdk.js";
import { TelemetryModule } from "../src/telemetry/telemetry.module.js";
import { telemetryEnv } from "../src/telemetry/telemetry-env.js";
import { setTelemetrySdk } from "../src/telemetry/telemetry-state.js";
import { currentTraceId } from "../src/telemetry/trace-id.js";

describe("telemetryEnv", () => {
  it("defaults to no exporter", () => {
    expect(parseConfig(telemetryEnv, { OTEL_SERVICE_NAME: "api" })).toEqual({
      OTEL_SERVICE_NAME: "api",
      OTEL_TRACES_EXPORTER: "none",
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
    for (const exporter of ["pretty", "console"] as const) {
      expect(
        createTelemetrySdk({ OTEL_SERVICE_NAME: "api", OTEL_TRACES_EXPORTER: exporter }),
      ).toBeInstanceOf(NodeSDK);
    }
  });

  it("traces pg queries only inside a parent span", () => {
    const pg = telemetryInstrumentations().find((i) => i instanceof PgInstrumentation);
    expect(pg?.getConfig()).toMatchObject({ requireParentSpan: true });
  });

  it("skips express middleware spans, keeping routers and handlers", () => {
    const express = telemetryInstrumentations().find((i) => i instanceof ExpressInstrumentation);
    expect(express?.getConfig()).toMatchObject({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] });
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
        setHeader: () => response,
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
    expect(output).toContain("'client.address': 'redacted'");
    expect(output).not.toMatch(/'(client|network\.peer)\.address': '\d/);
  });

  it("prints one compact line per span with pretty, without the query string or addresses", () => {
    const entry = fileURLToPath(new URL("../dist/telemetry/instrumentation.js", import.meta.url));
    const fixture = fileURLToPath(new URL("./fixtures/otel-smoke.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--import", entry, fixture], {
      env: { PATH: process.env.PATH, OTEL_SERVICE_NAME: "smoke", OTEL_TRACES_EXPORTER: "pretty" },
      encoding: "utf8",
      timeout: 20_000,
    });
    const logLine = JSON.parse(
      output.split("\n").find((line) => line.includes('"msg":"handled"')) ?? "{}",
    );
    const spans = output.split("\n").filter((line) => line.startsWith("[span] "));
    // Only the server side is traced (fetch runs on undici, which is not instrumented).
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatch(
      new RegExp(`^\\[span\\] ${logLine.trace_id.slice(0, 8)} GET \\d+ms method=GET status=200$`),
    );
    expect(output).not.toContain("token=");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("resource");
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

describe("TelemetryModule", () => {
  it("flushes the SDK when the app closes", async () => {
    const shutdown = vi.fn(async () => {});
    setTelemetrySdk({ shutdown } as unknown as NodeSDK);
    const moduleRef = await Test.createTestingModule({ imports: [TelemetryModule] }).compile();
    await moduleRef.init();
    await moduleRef.close();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
