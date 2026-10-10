import { fileURLToPath } from "node:url";
import { PG_POOL, runMigrations } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import type { INestApplication } from "@nestjs/common";
import pg, { type Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";
import { CONTENT_READER, createContentTestDatabase } from "./setup/content-database.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Postgres error wording that must never reach the health body. */
const SQL_ERROR_TEXT =
  /permission denied|does not exist|profile_translations|relation|content_reader/;

// WP-3 trace 1 against a real Postgres (pgvector image, the same tag as compose.dev.yml).
describe("api health against a real Postgres", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createContentTestDatabase();
    drop = database.drop;
    await runMigrations({ service: "api", url: database.url, migrationsFolder });
    app = await bootApi({
      DATABASE_URL: database.url,
      DATABASE_READ_URL: database.roleUrls[CONTENT_READER] ?? "",
    });
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  it("is ready when its database answers and the reader can read its tables", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      info: {
        shutdown: { status: "up" },
        database: { status: "up" },
        "content-reader": { status: "up" },
      },
    });
  });

  it("closes the pool on shutdown, after the server", async () => {
    // A real port here, addressed by URL: supertest would listen again on a closed server object.
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const pool = app.get<Pool>(PG_POOL);
    await app.close();
    await expect(request(base).get("/health/live")).rejects.toThrow();
    expect(pool.ended).toBe(true);
  });
});

// WP-12 step 7b: a reader credential Postgres refuses must fail readiness, not every public read.
describe("api health when only the reader cannot connect", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    const reader = new URL(database.url);
    reader.username = "no_such_reader";
    app = await bootApi({ DATABASE_URL: database.url, DATABASE_READ_URL: reader.toString() });
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  it("is not ready: the database is up, the content reader is down", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.body;
    expect(body).toMatchObject({
      status: "error",
      info: { database: { status: "up" } },
      error: { "content-reader": { status: "down", message: "unavailable" } },
    });
    expect(JSON.stringify(body)).not.toContain("no_such_reader");
  });
});

// Review fix: the reader's probe reads a granted table, so a reader that logs in but cannot read
// (migration 0002 not applied, or a grant missing) fails readiness instead of every public read.
// The steps run in order on one database: unmigrated, migrated, then one grant revoked.
describe("api health when the reader logs in but cannot read", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;
  let ownerUrl: string;

  beforeAll(async () => {
    const database = await createContentTestDatabase();
    drop = database.drop;
    ownerUrl = database.url;
    app = await bootApi({
      DATABASE_URL: database.url,
      DATABASE_READ_URL: database.roleUrls[CONTENT_READER] ?? "",
    });
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  /** GETs readiness and checks the body carries no Postgres error text. */
  async function ready(): Promise<request.Response> {
    const res = await request(app.getHttpServer()).get("/health/ready");
    expect(JSON.stringify(res.body)).not.toMatch(SQL_ERROR_TEXT);
    return res;
  }

  it("is not ready before migration 0002: the reader's tables do not exist yet", async () => {
    const res = await ready();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      info: { database: { status: "up" } },
      error: { "content-reader": { status: "down", message: "unavailable" } },
    });
  });

  it("is ready once the migrations ran", async () => {
    await runMigrations({ service: "api", url: ownerUrl, migrationsFolder });
    const res = await ready();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ info: { "content-reader": { status: "up" } } });
  });

  it("is not ready when the probed table loses its grant", async () => {
    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      await owner.query("REVOKE SELECT ON content.profile_translations FROM content_reader");
    } finally {
      await owner.end();
    }
    const res = await ready();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      info: { database: { status: "up" } },
      error: { "content-reader": { status: "down", message: "unavailable" } },
    });
  });
});
