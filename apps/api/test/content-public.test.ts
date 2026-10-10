import { encodePostCursor } from "@jadero/contracts";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentQueries } from "../src/modules/content/application/content-queries.js";
import {
  contentLanguage,
  PUBLIC_CACHE_CONTROL,
} from "../src/modules/content/presentation/public-cache.interceptor.js";
import { FakeContentQueries } from "./content-queries.fake.js";
import { bootApi } from "./setup/boot.js";
import { rawGet } from "./setup/raw-get.js";

// WP-12 step 7a, the HTTP side of the public reads on a fake query port (no database: nothing
// listens on port 1): URI versioning, parameter schemas, response schemas, cache headers and 304.
// The same routes on Postgres, through the read-only role, are content-public.int.test.ts.
const DATABASE_URL = "postgres://content:content@127.0.0.1:1/content_dev";

describe("public content reads over HTTP", () => {
  const queries = new FakeContentQueries();
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootApi({ DATABASE_URL }, (builder) =>
      builder.overrideProvider(ContentQueries).useValue(queries),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers under /v1 with the public cache headers and the body's language", async () => {
    const res = await fetch(`${base}/v1/content/es/profile`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
    expect(res.headers.get("content-language")).toBe("es");
    expect(res.headers.get("etag")).toMatch(/^W\/"/);
    expect(await res.json()).toMatchObject({ locale: "es", name: "Alex Example" });
  });

  it("answers a matching If-None-Match with 304, no body, the same validators and cache headers", async () => {
    const url = `${base}/v1/content/en/projects/sample-project`;
    const first = await rawGet(url);
    const etag = String(first.headers.etag);
    const again = await rawGet(url, { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    expect(again.headers.etag).toBe(etag);
    expect(again.headers["cache-control"]).toBe(PUBLIC_CACHE_CONTROL);
    expect(again.headers["content-language"]).toBe("en");
    // A different validator (the content changed since) gets the full body.
    expect((await rawGet(url, { "if-none-match": 'W/"0-stale"' })).status).toBe(200);
  });

  it("labels a German detail that fell back to English as English", async () => {
    const res = await fetch(`${base}/v1/content/de/projects/sample-project`);
    expect(res.headers.get("content-language")).toBe("en");
    expect(await res.json()).toMatchObject({ locale: "en", slug: "sample-project" });
  });

  it("lists every language present in a German list, German first", async () => {
    const res = await fetch(`${base}/v1/content/de/projects`);
    expect(res.headers.get("content-language")).toBe("de, en");
  });

  it("is a 404 problem without a public cache header when the item is absent", async () => {
    const res = await fetch(`${base}/v1/content/en/projects/no-such-project`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(res.headers.get("cache-control")).not.toBe(PUBLIC_CACHE_CONTROL);
    expect(res.headers.get("content-language")).toBeNull();
  });

  it("is a 400 problem for an unknown locale, before any query", async () => {
    const res = await fetch(`${base}/v1/content/fr/profile`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errors: [{ pointer: "#/locale" }] });
    expect(res.headers.get("cache-control")).not.toBe(PUBLIC_CACHE_CONTROL);
  });

  it("is a 400 problem for a malformed cursor or kind; a valid cursor reaches the query decoded", async () => {
    expect((await fetch(`${base}/v1/content/en/posts?cursor=not-a-cursor`)).status).toBe(400);
    expect((await fetch(`${base}/v1/content/en/projects?kind=secret`)).status).toBe(400);
    const position = {
      publishedAt: "2026-10-01T10:00:00.000Z",
      id: "01990000-0000-7000-8000-000000000301",
    };
    const res = await fetch(`${base}/v1/content/en/posts?cursor=${encodePostCursor(position)}`);
    expect(res.status).toBe(200);
    expect(queries.lastCursor).toEqual(position);
  });

  it("drops a private entry field a query returned by mistake (the response schema, D-67)", async () => {
    const res = await fetch(`${base}/v1/content/work/kb-sample-entry`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-language")).toBe("en");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("kb-sample-entry");
    expect(body).not.toHaveProperty("sources");
  });

  it("serves content only under a version, and the operational routes without one", async () => {
    expect((await fetch(`${base}/content/en/profile`)).status).toBe(404);
    expect((await fetch(`${base}/v2/content/en/profile`)).status).toBe(404);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });
});

describe("contentLanguage", () => {
  it("names the locale of a single item, or every locale of a list, the requested one first", () => {
    expect(contentLanguage({ locale: "en" }, "de")).toBe("en");
    expect(contentLanguage({ items: [{ locale: "en" }, { locale: "de" }] }, "de")).toBe("de, en");
    expect(contentLanguage({ items: [{ locale: "en" }, { locale: "en" }] }, "de")).toBe("en");
  });

  it("falls back to the requested language for a body that names none", () => {
    expect(contentLanguage({ items: [] }, "es")).toBe("es");
    expect(contentLanguage({ items: [{ id: "kb-a" }] }, "en")).toBe("en");
    expect(contentLanguage(null, "en")).toBe("en");
  });
});
