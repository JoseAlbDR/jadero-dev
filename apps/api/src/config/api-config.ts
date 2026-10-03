import { platformEnv } from "@jadero/platform-nest";
import { z } from "zod";

/** The environment `api` reads at boot: the platform variables, `SERVICE_NAME` defaulting to `api`. */
export const apiEnv = platformEnv.extend({
  SERVICE_NAME: z.string().min(1).default("api"),
});

/** The parsed `api` environment. */
export type ApiEnv = z.output<typeof apiEnv>;

/**
 * The typed configuration providers inject (WP-3 decision B2). An abstract class, so it is both
 * the type and the DI token, like the ports of ADR-003. Import it as a value, never `import type`.
 */
export abstract class ApiConfig {
  abstract readonly nodeEnv: ApiEnv["NODE_ENV"];
  abstract readonly port: number;
  abstract readonly logLevel: ApiEnv["LOG_LEVEL"];
  abstract readonly serviceName: string;
}

/**
 * Maps the parsed environment to the config object the app provides as {@link ApiConfig}.
 * @param env the result of `loadConfig(apiEnv)`.
 * @returns the configuration with camelCase names.
 */
export function toApiConfig(env: ApiEnv): ApiConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
  };
}
