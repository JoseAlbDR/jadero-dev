import { configureApp } from "@jadero/platform-nest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { apiEnv, toApiConfig } from "../../src/config/api-config.js";

/**
 * Boots the real `api` app the way `main.ts` does (same module, same `configureApp`), on a free
 * port, with the given environment on top of a quiet test default.
 * @param env variables to set, for example `DATABASE_URL`.
 * @returns the listening app and its base URL.
 */
export async function bootApi(
  env: Record<string, string>,
): Promise<{ app: INestApplication; base: string }> {
  const config = toApiConfig(
    apiEnv.parse({ PORT: "3001", NODE_ENV: "test", LOG_LEVEL: "fatal", ...env }),
  );
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
  await app.listen(0, "127.0.0.1");
  return { app, base: await app.getUrl() };
}
