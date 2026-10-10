import { PG_POOL } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";

// WP-3 trace 1 against a real Postgres (pgvector image, the same tag as compose.dev.yml).
describe("api health against a real Postgres", () => {
  let app: INestApplication;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    app = await bootApi({ DATABASE_URL: database.url });
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  it("is ready when its database answers", async () => {
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
