import { PG_POOL } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";

// WP-3 trace 1 against a real Postgres (pgvector image, the same tag as compose.dev.yml).
describe("api health against a real Postgres", () => {
  let app: INestApplication;
  let base: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    ({ app, base } = await bootApi({ DATABASE_URL: database.url }));
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  it("is ready when its database answers", async () => {
    const res = await fetch(`${base}/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      info: {
        shutdown: { status: "up" },
        database: { status: "up" },
        "content-reader": { status: "up" },
      },
    });
  });

  it("closes the pool on shutdown, after the server", async () => {
    const pool = app.get<Pool>(PG_POOL);
    await app.close();
    await expect(fetch(`${base}/health/live`)).rejects.toThrow();
    expect(pool.ended).toBe(true);
  });
});

// WP-12 step 7b: a reader credential Postgres refuses must fail readiness, not every public read.
describe("api health when only the reader cannot connect", () => {
  let app: INestApplication;
  let base: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    const reader = new URL(database.url);
    reader.username = "no_such_reader";
    ({ app, base } = await bootApi({
      DATABASE_URL: database.url,
      DATABASE_READ_URL: reader.toString(),
    }));
  });

  afterAll(async () => {
    await app.close();
    await drop();
  });

  it("is not ready: the database is up, the content reader is down", async () => {
    const res = await fetch(`${base}/health/ready`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      status: "error",
      info: { database: { status: "up" } },
      error: { "content-reader": { status: "down", message: "unavailable" } },
    });
    expect(JSON.stringify(body)).not.toContain("no_such_reader");
  });
});
