import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toJsonPointer } from "../src/errors/request-validation.exception.js";
import { LoggingModule } from "../src/logging/logging.module.js";
import { createApp } from "./create-app.js";
import { EchoController } from "./fixtures/echo.controller.js";
import { memoryStream } from "./memory-stream.js";

@Module({ controllers: [EchoController] })
class FixtureModule {}

describe("problem details (RFC 9457)", () => {
  const stream = memoryStream();
  let app: INestApplication;

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
    app = createApp(moduleRef);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Starts a request against the app; supertest binds a free port for it. */
  const http = () => request(app.getHttpServer());

  it("answers a validation failure with 400 and one pointer per invalid field", async () => {
    const { status, headers, body } = await http()
      .post("/__fixtures/echo")
      .set("X-Request-Id", "trace-two-0001")
      .send({ email: "not-an-email", locale: "fr" });
    expect(status).toBe(400);
    expect(headers["content-type"]).toMatch(/^application\/problem\+json/);
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
    const { status, body } = await http()
      .post("/__fixtures/echo")
      .send({ email: "ada@example.com", locale: "es" });
    expect(status).toBe(201);
    expect(body).toEqual({ email: "ada@example.com", locale: "es" });
  });

  it("keeps the status and message of a 4xx HTTP exception", async () => {
    const { status, body } = await http().get("/__fixtures/forbidden");
    expect(status).toBe(403);
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: "Not your draft.",
    });
  });

  it("answers an oversized body with 413, not a 500, and never echoes the query string", async () => {
    const { status, body } = await http()
      .post("/__fixtures/echo?email=ada@example.com")
      .send({ email: "x".repeat(200_000), locale: "es" });
    expect(status).toBe(413);
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Payload Too Large",
      status: 413,
      instance: "/__fixtures/echo",
    });
    expect(JSON.stringify(stream.lines)).not.toContain("ada@example.com");
    expect(stream.lines.some((line) => line.msg === "unhandled exception")).toBe(false);
  });

  it("turns an unknown route into a 404 problem", async () => {
    const { status, body } = await http().get("/nope?token=secret-value");
    expect(status).toBe(404);
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      instance: "/nope",
      detail: "Cannot GET /nope",
    });
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });

  it("shields an unexpected error: generic 500 to the client, the stack in the error log", async () => {
    const { status, body } = await http()
      .get("/__fixtures/boom")
      .set("X-Request-Id", "boom-request-01");
    expect(status).toBe(500);
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
