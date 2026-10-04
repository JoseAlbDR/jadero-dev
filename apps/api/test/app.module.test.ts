import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ApiConfig, apiEnv, toApiConfig } from "../src/config/api-config.js";

/** A provider in another module that needs the config, like every feature module will. */
@Injectable()
class NeedsConfig {
  constructor(readonly config: ApiConfig) {}
}

@Module({ providers: [NeedsConfig] })
class FeatureModule {}

describe("api config", () => {
  it("defaults SERVICE_NAME to api and maps to camelCase", () => {
    expect(
      toApiConfig(
        apiEnv.parse({
          PORT: "3001",
          DATABASE_URL: "postgres://content:content@127.0.0.1:5432/content_dev",
        }),
      ),
    ).toEqual({
      nodeEnv: "development",
      port: 3001,
      logLevel: "info",
      serviceName: "api",
      databaseUrl: "postgres://content:content@127.0.0.1:5432/content_dev",
    });
  });

  it("injects ApiConfig into a provider of another module (DI by abstract class under Vitest)", async () => {
    const config = toApiConfig(
      apiEnv.parse({
        PORT: "3001",
        NODE_ENV: "test",
        LOG_LEVEL: "fatal",
        DATABASE_URL: "postgres://content:content@127.0.0.1:5432/content_dev",
      }),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config), FeatureModule],
    }).compile();
    expect(moduleRef.get(NeedsConfig).config).toBe(config);
    await moduleRef.close();
  });
});
