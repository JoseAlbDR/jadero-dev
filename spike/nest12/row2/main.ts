import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger, LoggerModule, PinoLogger } from "nestjs-pino";

const REQ_ID = /^[A-Za-z0-9-]{8,128}$/;

/** A singleton provider that logs through the request-scoped child via AsyncLocalStorage. */
@Injectable()
export class WorkService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(WorkService.name);
  }

  /** Logs one line; it should carry the current request's req_id. */
  doWork(): string {
    this.logger.info("work done in singleton");
    return "ok";
  }
}

@Controller()
export class WorkController {
  constructor(private readonly work: WorkService) {}

  @Get("work")
  run(): { result: string } {
    return { result: this.work.doWork() };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        base: { service: "spike" },
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const incoming = req.headers["x-request-id"];
          const id =
            typeof incoming === "string" && REQ_ID.test(incoming) ? incoming : randomUUID();
          res.setHeader("x-request-id", id);
          return id;
        },
        customProps: (req: IncomingMessage) => ({
          req_id: (req as IncomingMessage & { id: unknown }).id,
        }),
        serializers: {
          req: (req: { id: unknown; method: string; url: string }) => ({
            method: req.method,
            url: req.url,
          }),
        },
        redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      },
    }),
  ],
  controllers: [WorkController],
  providers: [WorkService],
})
export class AppModule {}

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
await app.listen(3902, "127.0.0.1");

const res = await fetch("http://127.0.0.1:3902/work", {
  headers: { "x-request-id": "3b0e6c1e-6a4f-4c51-9d2e-1f0a7c2b9e44" },
});
console.error("response x-request-id:", res.headers.get("x-request-id"), await res.text());
const res2 = await fetch("http://127.0.0.1:3902/work", { headers: { "x-request-id": "short" } });
console.error("bad header replaced by:", res2.headers.get("x-request-id"));
await app.close();
