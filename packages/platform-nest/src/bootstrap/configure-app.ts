import {
  type NestApplicationOptions,
  StandardSchemaValidationPipe,
  VersioningType,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import type { PlatformEnv } from "../config/platform-env.js";
import { ProblemDetailsFilter } from "../errors/problem-details.filter.js";
import { RequestValidationException } from "../errors/request-validation.exception.js";

/**
 * The options every service creates its app with (`NestFactory.create(module, APP_OPTIONS)`, and
 * `createNestApplication(APP_OPTIONS)` in tests): logs buffered until pino is in place, and Nest's
 * default body parsers off, so {@link configureApp} registers the only one, JSON with the
 * configured limit. Without `bodyParser: false` Nest would also add a URL-encoded form parser.
 */
export const APP_OPTIONS = {
  bufferLogs: true,
  bodyParser: false,
} as const satisfies NestApplicationOptions;

/**
 * Security headers for a JSON API (ADR-047, the `platform-nest` part): no HTML is served, so the
 * policy forbids loading anything and being framed, the body is never MIME-sniffed, never read
 * cross-origin, and no referrer leaves. Helmet's HTML-oriented defaults are off, and so is HSTS,
 * which nginx owns for the whole domain.
 */
const jsonApiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
  xContentTypeOptions: true,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  strictTransportSecurity: false,
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xFrameOptions: false,
  xPermittedCrossDomainPolicies: false,
  xXssProtection: false,
});

/**
 * The one place that wires an app the same way for `main.ts` and for end-to-end tests:
 * - the JSON API security headers through Helmet, and no `X-Powered-By` (ADR-047). CORS stays
 *   closed: no service calls `enableCors`, so no response carries an `Access-Control-*` header;
 * - one body parser, JSON, with the configured limit (`HTTP_JSON_BODY_LIMIT`); a larger body is a
 *   413 problem. Create the app with {@link APP_OPTIONS}, which turns Nest's defaults off;
 * - Nest's own logs go through pino (the logs wait in the buffer `APP_OPTIONS` turns on);
 * - every `@Body({ schema })`, `@Query({ schema })` and `@Param({ schema })` is validated, and a
 *   failure keeps its structured issues;
 * - every error leaves as RFC 9457 problem details, with `Cache-Control: no-store`;
 * - URI versioning (WP-12 amendment of 2026-10-09): a controller that declares `version: "1"`
 *   answers under `/v1/...`; operational routes (`/health`, `/dev/ping`) declare
 *   `VERSION_NEUTRAL` and keep their unversioned paths. A breaking change adds `version: "2"` on
 *   the endpoints that change, next to v1 (expand/contract);
 * - shutdown hooks, so SIGTERM runs `app.close()` and the lifecycle hooks.
 * Requires `LoggingModule`.
 * @param app the application returned by `NestFactory.create` or `createNestApplication`, created
 * with {@link APP_OPTIONS}.
 * @param env the service's parsed environment, for the body limit.
 * @returns the same app, for chaining.
 */
export function configureApp<T extends NestExpressApplication>(
  app: T,
  env: Pick<PlatformEnv, "HTTP_JSON_BODY_LIMIT">,
): T {
  app.disable("x-powered-by");
  app.use(jsonApiHelmet);
  app.useBodyParser("json", { limit: env.HTTP_JSON_BODY_LIMIT });
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
