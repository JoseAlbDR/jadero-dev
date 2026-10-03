import type { INestApplication } from "@nestjs/common";
import { Logger } from "nestjs-pino";

/**
 * The one place that wires an app the same way for `main.ts` and for end-to-end tests.
 * Routes Nest's own logs through pino (create the app with `bufferLogs: true` so the boot lines
 * wait for it) and enables shutdown hooks, so SIGTERM runs `app.close()` and the lifecycle hooks.
 * The validation pipe and the problem-details filter join in step 5. Requires `LoggingModule`.
 * @param app the application returned by `NestFactory.create` or `createNestApplication`.
 * @returns the same app, for chaining.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  return app;
}
