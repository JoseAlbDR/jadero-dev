import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";
import { createTestDatabase } from "./setup/test-database.js";

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
      info: { shutdown: { status: "up" }, database: { status: "up" } },
    });
  });

  it("closes the pool on shutdown, after the server", async () => {
    await app.close();
    await expect(fetch(`${base}/health/live`)).rejects.toThrow();
  });
});
