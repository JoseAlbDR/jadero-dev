import { APP_OPTIONS, configureApp } from "@jadero/platform-nest";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { apiEnv, toApiConfig } from "../../src/config/api-config.js";

/**
 * Boots the real `api` app the way `main.ts` does (same module, same `configureApp`), initialized
 * but not listening: tests drive it with `request(app.getHttpServer())` (supertest binds a free
 * port per request). The environment goes on top of a quiet test default. `DATABASE_READ_URL` defaults to
 * `DATABASE_URL` for tests that never read content; the content tests pass the `content_reader`
 * URL of their test database.
 * @param env variables to set, for example `DATABASE_URL`.
 * @param override replaces providers before compiling, for example a port with its fake.
 * @returns the initialized app.
 */
export async function bootApi(
  env: Record<string, string>,
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<INestApplication> {
  const parsed = apiEnv.parse({
    PORT: "3001",
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    ...(env.DATABASE_URL === undefined ? {} : { DATABASE_READ_URL: env.DATABASE_URL }),
    ...env,
  });
  const config = toApiConfig(parsed);
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule.forRoot(config)] }),
  ).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS),
    parsed,
  );
  await app.init();
  return app;
}
