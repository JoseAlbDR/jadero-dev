import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";

const DATABASE_URL = "postgres://content:content@127.0.0.1:1/content_dev";

describe("POST /dev/ping", () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("does not exist outside development: anyone could fill the queues", async () => {
    const booted = await bootApi({ NODE_ENV: "production", DATABASE_URL });
    app = booted.app;
    const response = await fetch(`${booted.base}/dev/ping`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("exists in development (here the database is down, so it fails as a problem, not a 404)", async () => {
    const booted = await bootApi({ NODE_ENV: "development", DATABASE_URL });
    app = booted.app;
    const response = await fetch(`${booted.base}/dev/ping`, { method: "POST" });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
