import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoggingModule } from "../src/logging/logging.module.js";
import { createApp } from "./create-app.js";
import { EchoController } from "./fixtures/echo.controller.js";
import { memoryStream } from "./memory-stream.js";

@Module({ controllers: [EchoController] })
class FixtureModule {}

const corsHeaders = (headers: Readonly<Record<string, unknown>>) =>
  Object.keys(headers).filter((name) => name.toLowerCase().startsWith("access-control-"));

// ADR-047, the platform-nest part: the JSON API headers, no X-Powered-By, CORS closed, the body
// limit from configuration; and WP-12 D6: no error is ever cached.
describe("HTTP hardening of every service (ADR-047)", () => {
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
    // A small configured limit, so the test proves the configuration is what applies.
    app = createApp(moduleRef, "1kb");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends the JSON API security headers and nothing that names the stack", async () => {
    const res = await request(app.getHttpServer())
      .get("/__fixtures/ok")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    // nginx owns HSTS; the HTML-oriented Helmet defaults are off.
    for (const name of [
      "strict-transport-security",
      "x-frame-options",
      "cross-origin-opener-policy",
      "origin-agent-cluster",
      "x-dns-prefetch-control",
      "x-download-options",
      "x-permitted-cross-domain-policies",
      "x-xss-protection",
    ]) {
      expect(res.headers[name], name).toBeUndefined();
    }
    expect(corsHeaders(res.headers)).toEqual([]);
  });

  it("answers a CORS preflight without opening anything", async () => {
    const res = await request(app.getHttpServer())
      .options("/__fixtures/echo")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(corsHeaders(res.headers)).toEqual([]);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers a body over the configured limit with a 413 problem that is never cached", async () => {
    const res = await request(app.getHttpServer())
      .post("/__fixtures/echo")
      .send({ email: "x".repeat(2000), locale: "es" });
    expect(res.status).toBe(413);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toMatchObject({
      type: "about:blank",
      title: "Payload Too Large",
      status: 413,
      instance: "/__fixtures/echo",
    });
  });

  it("accepts a body under the limit", async () => {
    const res = await request(app.getHttpServer())
      .post("/__fixtures/echo")
      .send({ email: "ada@example.com", locale: "es" });
    expect(res.status).toBe(201);
  });

  it("parses JSON only: a form body never reaches the handler", async () => {
    const res = await request(app.getHttpServer())
      .post("/__fixtures/echo")
      .type("form")
      .send("email=ada%40example.com&locale=es");
    // With a URL-encoded parser this body would be valid and answer 201.
    expect(res.status).toBe(400);
  });

  it.each([
    ["404", "/nope", 404],
    ["400", "/__fixtures/echo", 400],
    ["403", "/__fixtures/forbidden", 403],
    ["500", "/__fixtures/boom", 500],
  ])("marks a %s problem no-store", async (_name, path, status) => {
    const http = request(app.getHttpServer());
    const res = await (path === "/__fixtures/echo"
      ? http.post(path).set("Content-Type", "application/json").send("{}")
      : http.get(path).set("Content-Type", "application/json"));
    expect(res.status).toBe(status);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  });

  // Owner decision A (2026-10-10, observability first): a request Helmet or the JSON parser
  // rejects still gets a request id and its one pino-http line, like any other request.
  it.each([
    ["a body over the limit", JSON.stringify({ email: `body-marker-${"x".repeat(2000)}` }), 413],
    ["malformed JSON", '{"email": body-marker-not-json', 400],
  ])("gives %s a request id and exactly one request line", async (_case, body, status) => {
    const res = await request(app.getHttpServer())
      .post("/__fixtures/echo?email=query-marker%40example.com")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(status);
    const id = res.headers["x-request-id"] ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toMatchObject({ status, requestId: id });
    const requestLines = stream.lines.filter((line) => line.req_id === id && "res" in line);
    expect(requestLines).toHaveLength(1);
    expect(requestLines[0]).toMatchObject({
      level: 40,
      req: { method: "POST", url: "/__fixtures/echo" },
      res: { statusCode: status },
    });
    const all = JSON.stringify(stream.lines);
    expect(all).not.toContain("body-marker");
    expect(all).not.toContain("query-marker");
  });

  it("logs a failed query with its code and SQL, never its values", async () => {
    const res = await request(app.getHttpServer())
      .get("/__fixtures/query-error")
      .set("X-Request-Id", "query-error-01");
    expect(res.status).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
    const logged = stream.lines.find(
      (line) => line.msg === "unhandled exception" && line.req_id === "query-error-01",
    );
    expect(logged?.err).toMatchObject({
      type: "RedactedQueryError",
      message: "Database query failed (SQLSTATE 23505)",
      code: "23505",
      constraint: "project_slug_key",
      table: "project",
      schema: "content",
      query: 'insert into "content"."project" ("slug", "owner_email") values ($1, $2)',
    });
    const all = JSON.stringify(stream.lines);
    expect(all).not.toContain("secret-slug");
    expect(all).not.toContain("ada@example.com");
  });
});
