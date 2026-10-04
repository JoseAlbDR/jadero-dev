import {
  DatabaseModule,
  HealthModule,
  LoggingModule,
  PostgresReadinessCheck,
  TelemetryModule,
} from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { AgentConfig, AgentConsumerConfig } from "./config/agent-config.js";
import { BrokerReadinessCheck, HeartbeatModule } from "./modules/heartbeat/index.js";

/**
 * The root module of `agent`'s consumer process (report section 3.2; `agent-ingest` in WP-20): it
 * consumes events into `agent`'s own database and serves `/health/*` only; ready means Postgres and
 * RabbitMQ both answer.
 */
@Module({})
export class ConsumerModule {
  /**
   * @param config the parsed configuration from `toAgentConsumerConfig(loadConfig(agentConsumerEnv))`.
   * @returns the root module, with `AgentConsumerConfig` and `AgentConfig` provided globally.
   */
  static forRoot(config: AgentConsumerConfig): DynamicModule {
    return {
      module: ConsumerModule,
      global: true,
      imports: [
        LoggingModule.forRoot({
          serviceName: config.serviceName,
          level: config.logLevel,
          pretty: config.nodeEnv === "development",
        }),
        DatabaseModule.forRoot({ url: config.databaseUrl, poolMax: config.databasePoolMax }),
        HealthModule.forRoot({
          imports: [HeartbeatModule],
          checks: [PostgresReadinessCheck, BrokerReadinessCheck],
        }),
        TelemetryModule,
        HeartbeatModule,
      ],
      providers: [
        { provide: AgentConsumerConfig, useValue: config },
        { provide: AgentConfig, useValue: config },
      ],
      exports: [AgentConsumerConfig, AgentConfig],
    };
  }
}
