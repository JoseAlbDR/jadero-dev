import { HealthModule, LoggingModule, TelemetryModule } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { AgentConfig } from "./config/agent-config.js";
import { PostgresModule, PostgresReadinessCheck } from "./modules/platform/index.js";

/**
 * The root module of `agent`, the HTTP process type: health checks today, chat from WP-22 on. Ready
 * means its own database answers; the broker is the consumer process's concern (decision W1).
 */
@Module({})
export class AppModule {
  /**
   * @param config the parsed configuration from `toAgentConfig(loadConfig(agentEnv))`.
   * @returns the root module with `AgentConfig` provided globally.
   */
  static forRoot(config: AgentConfig): DynamicModule {
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
      ],
      providers: [{ provide: AgentConfig, useValue: config }],
      exports: [AgentConfig],
    };
  }
}
