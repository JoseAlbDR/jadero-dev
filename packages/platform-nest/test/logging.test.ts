import { Controller, Get, type INestApplication, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PinoLogger } from "nestjs-pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoggingModule } from "../src/logging/logging.module.js";
import { createApp } from "./create-app.js";
import { memoryStream } from "./memory-stream.js";

/** A singleton provider: its log line must still carry the current request's id. */
@Injectable()
class WorkService {
  constructor(private readonly logger: PinoLogger) {}

  work(): string {
    this.logger.info("work done");
    return "ok";
  }
}

@Controller()
class ProbeController {
  constructor(private readonly service: WorkService) {}

  @Get("work")
  work(): { result: string } {
    return { result: this.service.work() };
  }

  @Get("health/live")
  live(): { status: string } {
    return { status: "ok" };
  }
}

@Module({ controllers: [ProbeController], providers: [WorkService] })
class ProbeModule {}

describe("LoggingModule", () => {
  const stream = memoryStream();
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          serviceName: "probe",
          level: "debug",
          pretty: false,
          destination: stream,
        }),
        ProbeModule,
      ],
    }).compile();
    app = createApp(moduleRef);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const requestLine = (id: string) =>
    stream.lines.find((line) => line.req_id === id && line.msg === "request completed");

  it("reuses a valid x-request-id on the singleton's line and the request line", async () => {
    const id = "3b0e6c1e-6a4f-4c51-9d2e-1f0a7c2b9e44";
    const res = await fetch(`${base}/work`, {
      headers: {
        "x-request-id": id,
        authorization: "Bearer secret-token",
        cookie: "sid=secret-cookie",
      },
    });
    expect(res.headers.get("x-request-id")).toBe(id);
    const workLine = stream.lines.find((line) => line.msg === "work done");
    expect(workLine).toMatchObject({ req_id: id, service: "probe", level: 30 });
    expect(requestLine(id)).toMatchObject({
      req: { method: "GET", url: "/work" },
      res: { statusCode: 200 },
    });
  });

  it("never logs headers, the client IP or their values", () => {
    const all = JSON.stringify(stream.lines);
    expect(all).not.toContain("secret-token");
    expect(all).not.toContain("secret-cookie");
    expect(all).not.toContain("127.0.0.1");
    expect(all).not.toContain("remoteAddress");
  });

  it.each([
    ["spaces and quotes", 'id with "quotes"'],
    ["too long", "a".repeat(200)],
  ])("replaces an unsafe x-request-id (%s) with a new UUID", async (_case, unsafe) => {
    const res = await fetch(`${base}/work`, { headers: { "x-request-id": unsafe } });
    const id = res.headers.get("x-request-id") ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLine(id)).toBeDefined();
  });

  it("logs health probes at debug and other requests at info", async () => {
    const res = await fetch(`${base}/health/live`);
    const id = res.headers.get("x-request-id") ?? "";
    expect(requestLine(id)?.level).toBe(20);
  });

  it("routes Nest's own boot lines through pino", () => {
    expect(stream.lines.some((line) => line.context === "NestApplication")).toBe(true);
  });
});
