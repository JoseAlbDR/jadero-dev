import type { NestExpressApplication } from "@nestjs/platform-express";
import type { TestingModule } from "@nestjs/testing";
import { APP_OPTIONS, configureApp } from "../src/bootstrap/configure-app.js";
import { DEFAULT_JSON_BODY_LIMIT } from "../src/config/platform-env.js";

/**
 * Creates and configures a test app the way `main.ts` does: `APP_OPTIONS`, then `configureApp`.
 * @param moduleRef the compiled testing module.
 * @param jsonBodyLimit the `HTTP_JSON_BODY_LIMIT` to configure; the platform default otherwise.
 * @returns the configured app, not yet listening.
 */
export function createApp(
  moduleRef: TestingModule,
  jsonBodyLimit = DEFAULT_JSON_BODY_LIMIT,
): NestExpressApplication {
  return configureApp(moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS), {
    HTTP_JSON_BODY_LIMIT: jsonBodyLimit,
  });
}
