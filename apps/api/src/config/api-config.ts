import { platformEnv } from "@jadero/platform-nest";
import { z } from "zod";

/**
 * The environment `api` reads at boot: the platform variables, `SERVICE_NAME` defaulting to `api`,
 * and its own database (`content_dev` in development, ADR-029).
 */
export const apiEnv = platformEnv.extend({
  SERVICE_NAME: z.string().min(1).default("api"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
  abstract readonly databaseUrl: string;
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
    databaseUrl: env.DATABASE_URL,
  };
}

/**
 * The environment of `api-worker`, the second process type of `api` (report section 3.2): the same
 * variables, plus the broker it publishes to and the heartbeat interval. Its `PORT` serves health
 * checks only.
 */
export const apiWorkerEnv = apiEnv.extend({
  SERVICE_NAME: z.string().min(1).default("api-worker"),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  HEARTBEAT_INTERVAL_MS: z.coerce.number<string>().int().min(1000).default(300_000),
});

/** The parsed `api-worker` environment. */
export type ApiWorkerEnv = z.output<typeof apiWorkerEnv>;

/** The configuration of `api-worker`; it also provides {@link ApiConfig} for the shared modules. */
export abstract class ApiWorkerConfig extends ApiConfig {
  abstract readonly rabbitmqUrl: string;
  abstract readonly heartbeatIntervalMs: number;
}

/**
 * @param env the result of `loadConfig(apiWorkerEnv)`.
 * @returns the worker configuration.
 */
export function toApiWorkerConfig(env: ApiWorkerEnv): ApiWorkerConfig {
  return {
    ...toApiConfig(env),
    rabbitmqUrl: env.RABBITMQ_URL,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  };
}
