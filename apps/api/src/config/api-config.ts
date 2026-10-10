import { platformEnv } from "@jadero/platform-nest";
import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/**
 * What both process types of `api` read: the platform variables and the service's own database
 * (`content_dev` in development, ADR-029) as its owner role, with the pool size.
 */
const apiSharedEnv = platformEnv.extend({
  SERVICE_NAME: z.string().min(1).default("api"),
  DATABASE_URL: postgresUrl,
  // Room for a readiness check, the relay's batch and the heartbeat at once (api-worker too).
  DATABASE_POOL_MAX: z.coerce.number<string>().int().min(1).default(4),
});

/**
 * The environment `api` reads at boot: the shared variables, `SERVICE_NAME` defaulting to `api`,
 * and `DATABASE_READ_URL`, the same database as the read-only `content_reader` role, which only
 * the public content reads use (WP-12 step 7, least privilege). Its pool has the same size.
 */
export const apiEnv = apiSharedEnv.extend({
  DATABASE_READ_URL: postgresUrl,
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
  abstract readonly databasePoolMax: number;
  /** The read-only `content_reader` connection of the public content reads. Never logged. */
  abstract readonly databaseReadUrl: string;
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
    databasePoolMax: env.DATABASE_POOL_MAX,
    databaseReadUrl: env.DATABASE_READ_URL,
  };
}

/**
 * The environment of `api-worker`, the second process type of `api` (report section 3.2): the shared
 * variables, plus the broker it publishes to and the heartbeat interval. Its `PORT` serves health
 * checks only. No `DATABASE_READ_URL`: the worker serves no public reads, so it never holds that
 * credential.
 */
export const apiWorkerEnv = apiSharedEnv.extend({
  SERVICE_NAME: z.string().min(1).default("api-worker"),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  HEARTBEAT_INTERVAL_MS: z.coerce.number<string>().int().min(1000).default(300_000),
});

/** The parsed `api-worker` environment. */
export type ApiWorkerEnv = z.output<typeof apiWorkerEnv>;

/**
 * The configuration of `api-worker`: the shared fields of {@link ApiConfig}, without the read-only
 * connection, plus the broker and the heartbeat.
 */
export abstract class ApiWorkerConfig {
  abstract readonly nodeEnv: ApiWorkerEnv["NODE_ENV"];
  abstract readonly port: number;
  abstract readonly logLevel: ApiWorkerEnv["LOG_LEVEL"];
  abstract readonly serviceName: string;
  abstract readonly databaseUrl: string;
  abstract readonly databasePoolMax: number;
  abstract readonly rabbitmqUrl: string;
  abstract readonly heartbeatIntervalMs: number;
}

/**
 * @param env the result of `loadConfig(apiWorkerEnv)`.
 * @returns the worker configuration.
 */
export function toApiWorkerConfig(env: ApiWorkerEnv): ApiWorkerConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    rabbitmqUrl: env.RABBITMQ_URL,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  };
}
