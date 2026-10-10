import { z } from "zod";

/** Express's own default, made explicit (ADR-047): no JSON route needs more yet. */
export const DEFAULT_JSON_BODY_LIMIT = "100kb";

/**
 * The environment every Nest service reads. A service extends it with its own variables
 * (`platformEnv.extend({ DATABASE_URL: z.url() })`) and may give `SERVICE_NAME` a default.
 */
export const platformEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // string first, so a missing PORT reads "received undefined" instead of coerce's "received NaN"
  PORT: z.string().pipe(z.coerce.number<string>().int().min(1).max(65_535)),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SERVICE_NAME: z.string().min(1),
  // The largest JSON request body, in body-parser's units ("100kb", "1mb"); a larger one is a 413.
  HTTP_JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb|b)$/, 'a size such as "100kb" or "1mb"')
    .default(DEFAULT_JSON_BODY_LIMIT),
});

/** The parsed platform environment. */
export type PlatformEnv = z.output<typeof platformEnv>;
