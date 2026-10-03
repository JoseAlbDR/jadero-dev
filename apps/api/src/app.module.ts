import { type DynamicModule, Module } from "@nestjs/common";
import { ApiConfig } from "./config/api-config.js";

/** The root module of `api`. Feature modules join from WP-10 on. */
@Module({})
export class AppModule {
  /**
   * Builds the root module around an already validated configuration, so a bad environment never
   * reaches a module. `ApiConfig` is global: any provider can inject it.
   * @param config the parsed configuration from `toApiConfig(loadConfig(apiEnv))`.
   * @returns the root module with `ApiConfig` provided.
   */
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      providers: [{ provide: ApiConfig, useValue: config }],
      exports: [ApiConfig],
    };
  }
}
