import { request } from "node:http";
import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoggingModule } from "../src/logging/logging.module.js";
import { createApp } from "./create-app.js";
import { EchoController } from "./fixtures/echo.controller.js";
import { memoryStream } from "./memory-stream.js";

@Module({ controllers: [EchoController] })
class FixtureModule {}

interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * A request with exactly the given method and headers, through `node:http`: `fetch` may refuse
 * or rewrite `Origin` and the CORS request headers a browser would send on a preflight.
 */
function rawRequest(url: string, method: string, headers: Record<string, string>) {
  return new Promise<RawResponse>((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

const corsHeaders = (headers: RawResponse["headers"] | Headers) =>
  (headers instanceof Headers ? [...headers.keys()] : Object.keys(headers)).filter((name) =>
    name.toLowerCase().startsWith("access-control-"),
  );

// ADR-047, the platform-nest part: the JSON API headers, no X-Powered-By, CORS closed, the body
// limit from configuration; and WP-12 D6: no error is ever cached.
describe("HTTP hardening of every service (ADR-047)", () => {
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
    // A small configured limit, so the test proves the configuration is what applies.
    app = createApp(moduleRef, "1kb");
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends the JSON API security headers and nothing that names the stack", async () => {
    const res = await fetch(`${base}/__fixtures/ok`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-powered-by")).toBeNull();
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
      expect(res.headers.get(name), name).toBeNull();
    }
    expect(corsHeaders(res.headers)).toEqual([]);
  });

  it("answers a CORS preflight without opening anything", async () => {
    const res = await rawRequest(`${base}/__fixtures/echo`, "OPTIONS", {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    });
    expect(corsHeaders(res.headers)).toEqual([]);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers a body over the configured limit with a 413 problem that is never cached", async () => {
    const res = await fetch(`${base}/__fixtures/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x".repeat(2000), locale: "es" }),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toMatchObject({
      type: "about:blank",
      title: "Payload Too Large",
      status: 413,
      instance: "/__fixtures/echo",
    });
  });

  it("accepts a body under the limit", async () => {
    const res = await fetch(`${base}/__fixtures/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", locale: "es" }),
    });
    expect(res.status).toBe(201);
  });

  it("parses JSON only: a form body never reaches the handler", async () => {
    const res = await fetch(`${base}/__fixtures/echo`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=ada%40example.com&locale=es",
    });
    // With a URL-encoded parser this body would be valid and answer 201.
    expect(res.status).toBe(400);
  });

  it.each([
    ["404", "/nope", 404],
    ["400", "/__fixtures/echo", 400],
    ["403", "/__fixtures/forbidden", 403],
    ["500", "/__fixtures/boom", 500],
  ])("marks a %s problem no-store", async (_name, path, status) => {
    const res = await fetch(`${base}${path}`, {
      method: path === "/__fixtures/echo" ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(path === "/__fixtures/echo" ? { body: "{}" } : {}),
    });
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
  });

  it("logs a failed query with its code and SQL, never its values", async () => {
    const res = await fetch(`${base}/__fixtures/query-error`, {
      headers: { "x-request-id": "query-error-01" },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
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
