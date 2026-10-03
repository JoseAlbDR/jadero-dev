import { z } from "zod";

/**
 * The environment every Nest service reads. A service extends it with its own variables
 * (`platformEnv.extend({ DATABASE_URL: z.url() })`) and may give `SERVICE_NAME` a default.
 */
export const platformEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SERVICE_NAME: z.string().min(1),
});

/** The parsed platform environment. */
export type PlatformEnv = z.output<typeof platformEnv>;
