import { HealthModule, LoggingModule, TelemetryModule } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { ApiConfig, ApiWorkerConfig } from "./config/api-config.js";
import { PostgresModule, PostgresReadinessCheck } from "./modules/platform/index.js";
import { BrokerReadinessCheck, RelayModule } from "./modules/relay/index.js";

/**
 * The root module of `api-worker`, `api`'s second process type (report section 3.2): same code and
 * database, its own process, memory limit and restart policy. It runs the outbox relay and the
 * heartbeat, and serves `/health/*` only; ready means Postgres and RabbitMQ both answer.
 */
@Module({})
export class WorkerModule {
  /**
   * @param config the parsed configuration from `toApiWorkerConfig(loadConfig(apiWorkerEnv))`.
   * @returns the root module, with `ApiWorkerConfig` and `ApiConfig` provided globally.
   */
  static forRoot(config: ApiWorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      imports: [
        LoggingModule.forRoot({
          serviceName: config.serviceName,
          level: config.logLevel,
          pretty: config.nodeEnv === "development",
        }),
        HealthModule.forRoot({
          imports: [PostgresModule, RelayModule],
          checks: [PostgresReadinessCheck, BrokerReadinessCheck],
        }),
        TelemetryModule,
        RelayModule,
      ],
      providers: [
        { provide: ApiWorkerConfig, useValue: config },
        { provide: ApiConfig, useValue: config },
      ],
      exports: [ApiWorkerConfig, ApiConfig],
    };
  }
}
