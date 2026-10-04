import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";

// The "Postgres stopped" half of trace 1, without Docker: nothing listens on port 1.
describe("api health with its database down", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootApi({
      DATABASE_URL: "postgres://content:content@127.0.0.1:1/content_dev",
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("still boots and is live", async () => {
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });

  it("is not ready, and the body names the database without the connection details", async () => {
    const res = await fetch(`${base}/health/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "error",
      error: { database: { status: "down", message: "unavailable" } },
    });
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
  });
});
