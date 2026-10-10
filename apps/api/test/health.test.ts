import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";

// The "Postgres stopped" half of trace 1, without Docker: nothing listens on port 1. Also the
// real app's 404, which runs through the global problem-details filter.
describe("api health with its database down", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootApi({ DATABASE_URL: "postgres://content:content@127.0.0.1:1/content_dev" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("still boots and is live", async () => {
    expect((await request(app.getHttpServer()).get("/health/live")).status).toBe(200);
  });

  it("is not ready, and the body names both pools without the connection details", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready");
    expect(res.status).toBe(503);
    const body = res.body;
    expect(body).toMatchObject({
      status: "error",
      error: {
        database: { status: "down", message: "unavailable" },
        "content-reader": { status: "down", message: "unavailable" },
      },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
  });

  it("answers an unknown route with a 404 problem", async () => {
    const res = await request(app.getHttpServer()).get("/posts/42");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      instance: "/posts/42",
    });
  });
});
