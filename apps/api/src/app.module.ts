import { HealthModule, LoggingModule, TelemetryModule } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { ApiConfig } from "./config/api-config.js";
import { DevPingModule } from "./modules/ping/index.js";
import { PostgresModule, PostgresReadinessCheck } from "./modules/platform/index.js";

/** The root module of `api`, the HTTP process type. Feature modules join from WP-10 on. */
@Module({})
export class AppModule {
  /**
   * Builds the root module around an already validated configuration, so a bad environment never
   * reaches a module. `ApiConfig` is global: any provider can inject it. Logging, health and the
   * telemetry flush come from `platform-nest`; `api` registers its database as the readiness check.
   * @param config the parsed configuration from `toApiConfig(loadConfig(apiEnv))`.
   * @returns the root module with `ApiConfig` provided.
   */
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggingModule.forRoot({
          serviceName: config.serviceName,
          level: config.logLevel,
          pretty: config.nodeEnv === "development",
        }),
        HealthModule.forRoot({ imports: [PostgresModule], checks: [PostgresReadinessCheck] }),
        TelemetryModule,
        // POST /dev/ping exists in development only (WP-5 decision W1 c).
        ...(config.nodeEnv === "development" ? [DevPingModule] : []),
      ],
      providers: [{ provide: ApiConfig, useValue: config }],
      exports: [ApiConfig],
    };
  }
}
