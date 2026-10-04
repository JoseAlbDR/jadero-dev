import { type INestApplication, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApp } from "../src/bootstrap/configure-app.js";
import { CHECK_TIMEOUT_MS } from "../src/health/health.controller.js";
import { HealthModule } from "../src/health/health.module.js";
import { ReadinessCheck } from "../src/health/readiness-check.js";
import { ShutdownState } from "../src/health/shutdown-state.js";
import { LoggingModule } from "../src/logging/logging.module.js";
import { memoryStream } from "./memory-stream.js";

/** A dependency whose answer each test controls. */
@Injectable()
class FakeDatabaseCheck extends ReadinessCheck {
  readonly name = "database";
  behavior: "up" | "down" | "hang" = "up";

  check(): Promise<void> {
    if (this.behavior === "down")
      return Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    if (this.behavior === "hang") return new Promise(() => {});
    return Promise.resolve();
  }
}

describe("HealthModule", () => {
  const stream = memoryStream();
  let app: INestApplication;
  let base: string;
  let database: FakeDatabaseCheck;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          serviceName: "probe",
          level: "debug",
          pretty: false,
          destination: stream,
        }),
        HealthModule.forRoot({ checks: [FakeDatabaseCheck] }),
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    database = app.get(FakeDatabaseCheck);
  });

  beforeEach(() => {
    database.behavior = "up";
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(path: string) {
    const res = await fetch(`${base}${path}`);
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  it("answers live with 200 without running any check", async () => {
    database.behavior = "down";
    const { res, body } = await get("/health/live");
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", info: {}, error: {}, details: {} });
  });

  it("answers ready with 200 when every check is up", async () => {
    const { res, body } = await get("/health/ready");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      info: { shutdown: { status: "up" }, database: { status: "up" } },
    });
  });

  it("answers ready with 503 and the Terminus body when a check fails, hiding the cause", async () => {
    database.behavior = "down";
    const failed = await get("/health/ready");
    expect(failed.res.status).toBe(503);
    expect(failed.res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(failed.body).toMatchObject({
      status: "error",
      error: { database: { status: "down", message: "unavailable" } },
    });
    expect(JSON.stringify(failed.body)).not.toContain("10.0.0.5");
    const logged = stream.lines.find((line) => line.msg === "readiness check failed");
    expect(JSON.stringify(logged)).toContain("10.0.0.5");
  });

  it("counts a check that does not answer in time as down", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    database.behavior = "hang";
    const pending = get("/health/ready");
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 10);
    vi.useRealTimers();
    const { res, body } = await pending;
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ error: { database: { status: "down" } } });
  });

  it("answers ready with 503 once shutdown has started, while live stays 200", async () => {
    await app.get(ShutdownState).beforeApplicationShutdown();
    expect((await get("/health/ready")).res.status).toBe(503);
    expect((await get("/health/live")).res.status).toBe(200);
  });

  it("logs health probes at debug", () => {
    const probe = stream.lines.find(
      (line) =>
        line.msg === "request completed" && (line.req as { url: string }).url === "/health/live",
    );
    expect(probe?.level).toBe(20);
  });
});
