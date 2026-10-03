import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureApp } from "../src/bootstrap/configure-app.js";
import { toJsonPointer } from "../src/errors/request-validation.exception.js";
import { LoggingModule } from "../src/logging/logging.module.js";
import { EchoController } from "./fixtures/echo.controller.js";
import { memoryStream } from "./memory-stream.js";

@Module({ controllers: [EchoController] })
class FixtureModule {}

describe("problem details (RFC 9457)", () => {
  const stream = memoryStream();
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          serviceName: "probe",
          level: "info",
          pretty: false,
          destination: stream,
        }),
        FixtureModule,
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(path: string, init?: RequestInit) {
    const res = await fetch(`${base}${path}`, init);
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  it("answers a validation failure with 400 and one pointer per invalid field", async () => {
    const { res, body } = await call("/__fixtures/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "trace-two-0001" },
      body: JSON.stringify({ email: "not-an-email", locale: "fr" }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
    expect(body).toEqual({
      type: "https://jadero.dev/problems/validation-failed",
      title: "Request validation failed",
      status: 400,
      detail: "2 fields are invalid.",
      instance: "/__fixtures/echo",
      errors: [
        { pointer: "#/email", detail: "Invalid email address" },
        { pointer: "#/locale", detail: 'Invalid option: expected one of "es"|"en"|"de"' },
      ],
      requestId: "trace-two-0001",
    });
  });

  it("passes a valid body through to the handler", async () => {
    const { res, body } = await call("/__fixtures/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", locale: "es" }),
    });
    expect(res.status).toBe(201);
    expect(body).toEqual({ email: "ada@example.com", locale: "es" });
  });

  it("keeps the status and message of a 4xx HTTP exception", async () => {
    const { res, body } = await call("/__fixtures/forbidden");
    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: "Not your draft.",
    });
  });

  it("turns an unknown route into a 404 problem", async () => {
    const { res, body } = await call("/nope");
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ type: "about:blank", title: "Not Found", instance: "/nope" });
  });

  it("shields an unexpected error: generic 500 to the client, the stack in the error log", async () => {
    const { res, body } = await call("/__fixtures/boom", {
      headers: { "x-request-id": "boom-request-01" },
    });
    expect(res.status).toBe(500);
    expect(body).toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "An unexpected error occurred.",
      instance: "/__fixtures/boom",
      requestId: "boom-request-01",
    });
    expect(JSON.stringify(body)).not.toContain("reading 'title'");
    const logged = stream.lines.find((line) => line.msg === "unhandled exception");
    expect(logged).toMatchObject({ level: 50, req_id: "boom-request-01" });
    expect(JSON.stringify(logged)).toContain("reading 'title'");
  });
});

describe("toJsonPointer", () => {
  it("builds pointers, escaping ~ and /", () => {
    expect(toJsonPointer(undefined)).toBe("#");
    expect(toJsonPointer(["items", 0, { key: "a/b~c" }])).toBe("#/items/0/a~1b~0c");
  });
});
