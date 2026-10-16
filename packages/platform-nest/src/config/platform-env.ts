import { z } from "zod";

/** Express's own default, made explicit (ADR-047): no JSON route needs more yet. */
export const DEFAULT_JSON_BODY_LIMIT = "100kb";

/** The default `HOST`: loopback only, so `pnpm dev` never listens on the LAN. */
export const DEFAULT_HOST = "127.0.0.1";

/**
 * The environment every Nest service reads. A service extends it with its own variables
 * (`platformEnv.extend({ DATABASE_URL: z.url() })`) and may give `SERVICE_NAME` a default.
 */
export const platformEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // string first, so a missing PORT reads "received undefined" instead of coerce's "received NaN"
  PORT: z.string().pipe(z.coerce.number<string>().int().min(1).max(65_535)),
  // The interface the HTTP server binds: loopback by default, so a dev server is not reachable from
  // the network; the images set 0.0.0.0 so the Compose network and the healthcheck reach it.
  HOST: z.union([z.ipv4(), z.ipv6(), z.hostname()]).default(DEFAULT_HOST),
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
