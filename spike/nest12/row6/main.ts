import "reflect-metadata";
import { Controller, Get, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger, LoggerModule, PinoLogger } from "nestjs-pino";
import pg from "pg";

/** Readiness-style check against a dead port: expects an error span from the pg instrumentation. */
@Injectable()
export class DbCheck implements OnApplicationShutdown {
  private readonly pool = new pg.Pool({
    connectionString: // row6-pg sets CONTENT_DATABASE_URL from the repo .env.example; plain row6 hits a dead port.
      process.env.CONTENT_DATABASE_URL ?? "postgres://nobody:nobody@127.0.0.1:59999/none",
    max: 2,
    connectionTimeoutMillis: 1000,
  });

  constructor(private readonly logger: PinoLogger) {}

  /** Runs SELECT 1 and reports up or down without leaking the driver message. */
  async check(): Promise<"up" | "down"> {
    try {
      await this.pool.query("SELECT 1");
      return "up";
    } catch {
      this.logger.warn("database check failed");
      return "down";
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbCheck) {}

  @Get("ready")
  async ready(): Promise<{ database: string }> {
    return { database: await this.db.check() };
  }
}

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: { base: { service: "spike" } } })],
  controllers: [HealthController],
  providers: [DbCheck],
})
export class AppModule {}

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
await app.listen(3907, "127.0.0.1");
const res = await fetch("http://127.0.0.1:3907/health/ready");
console.error("RESPONSE", res.status, await res.text());
await app.close();
