import type { INestApplication } from "@nestjs/common";

/**
 * The one place that wires an app the same way for `main.ts` and for end-to-end tests.
 * Today: shutdown hooks, so SIGTERM runs `app.close()` and the lifecycle hooks. The logger,
 * the validation pipe and the problem-details filter join in later WP-3 steps.
 * @param app the application returned by `NestFactory.create` or `createNestApplication`.
 * @returns the same app, for chaining.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.enableShutdownHooks();
  return app;
}
