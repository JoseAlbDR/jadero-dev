import {
  DatabaseModule,
  HealthModule,
  LoggingModule,
  PostgresReadinessCheck,
  TelemetryModule,
} from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { ApiConfig } from "./config/api-config.js";
import { ContentReaderReadinessCheck, PublicContentModule } from "./modules/content/index.js";
import { DevPingModule } from "./modules/ping/index.js";

/** The root module of `api`, the HTTP process type. */
@Module({})
export class AppModule {
  /**
   * Builds the root module around an already validated configuration, so a bad environment never
   * reaches a module. `ApiConfig` is global: any provider can inject it. Logging, health and the
   * telemetry flush come from `platform-nest`; so does the database connection to `api`'s own
   * database (global, WP-10), which is also the readiness check. The public content reads
   * (`/v1/content`) use their own read-only pool (`DATABASE_READ_URL`, WP-12 step 7), which has
   * its own readiness check (`content-reader`).
   * @param config the parsed configuration from `toApiConfig(loadConfig(apiEnv))`.
   * @returns the root module with `ApiConfig` provided.
   */
  static forRoot(config: ApiConfig): DynamicModule {
    // One module object for both imports, so the readiness check and the reads share one pool.
    const publicContent = PublicContentModule.forRoot({
      url: config.databaseReadUrl,
      poolMax: config.databasePoolMax,
    });
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggingModule.forRoot({
          serviceName: config.serviceName,
          level: config.logLevel,
          pretty: config.nodeEnv === "development",
        }),
        DatabaseModule.forRoot({ url: config.databaseUrl, poolMax: config.databasePoolMax }),
        HealthModule.forRoot({
          checks: [PostgresReadinessCheck, ContentReaderReadinessCheck],
          imports: [publicContent],
        }),
        TelemetryModule,
        publicContent,
        // POST /dev/ping exists in development only (WP-5 decision W1 c).
        ...(config.nodeEnv === "development" ? [DevPingModule] : []),
      ],
      providers: [{ provide: ApiConfig, useValue: config }],
      exports: [ApiConfig],
    };
  }
}
