import {
  type INestApplication,
  StandardSchemaValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { ProblemDetailsFilter } from "../errors/problem-details.filter.js";
import { RequestValidationException } from "../errors/request-validation.exception.js";

/**
 * The one place that wires an app the same way for `main.ts` and for end-to-end tests:
 * - Nest's own logs go through pino (create the app with `bufferLogs: true` so boot lines wait);
 * - every `@Body({ schema })`, `@Query({ schema })` and `@Param({ schema })` is validated, and a
 *   failure keeps its structured issues;
 * - every error leaves as RFC 9457 problem details;
 * - URI versioning (WP-12 amendment of 2026-10-09): a controller that declares `version: "1"`
 *   answers under `/v1/...`; operational routes (`/health`, `/dev/ping`) declare
 *   `VERSION_NEUTRAL` and keep their unversioned paths. A breaking change adds `version: "2"` on
 *   the endpoints that change, next to v1 (expand/contract);
 * - shutdown hooks, so SIGTERM runs `app.close()` and the lifecycle hooks.
 * Requires `LoggingModule`.
 * @param app the application returned by `NestFactory.create` or `createNestApplication`.
 * @returns the same app, for chaining.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) => new RequestValidationException(issues),
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();
  return app;
}
