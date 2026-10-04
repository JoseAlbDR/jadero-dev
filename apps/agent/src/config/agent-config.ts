import { platformEnv } from "@jadero/platform-nest";
import { z } from "zod";

/**
 * The environment `agent` reads at boot: the platform variables, `SERVICE_NAME` defaulting to
 * `agent`, and its own database (`agent_dev` in development, ADR-029) with its pool size.
 */
export const agentEnv = platformEnv.extend({
  SERVICE_NAME: z.string().min(1).default("agent"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // The consumer's prefetch (4) plus the readiness check and the inbox cleanup.
  DATABASE_POOL_MAX: z.coerce.number<string>().int().min(1).default(6),
});

/** The parsed `agent` environment. */
export type AgentEnv = z.output<typeof agentEnv>;

/**
 * The typed configuration providers inject (WP-3 decision B2): an abstract class, so it is both
 * the type and the DI token. Import it as a value, never `import type`.
 */
export abstract class AgentConfig {
  abstract readonly nodeEnv: AgentEnv["NODE_ENV"];
  abstract readonly port: number;
  abstract readonly logLevel: AgentEnv["LOG_LEVEL"];
  abstract readonly serviceName: string;
  abstract readonly databaseUrl: string;
  abstract readonly databasePoolMax: number;
}

/**
 * @param env the result of `loadConfig(agentEnv)`.
 * @returns the configuration with camelCase names.
 */
export function toAgentConfig(env: AgentEnv): AgentConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
  };
}

/**
 * The environment of the `agent` consumer process (it becomes `agent-ingest` in WP-20): the same
 * variables plus the broker it consumes from. Its `PORT` serves health checks only.
 */
export const agentConsumerEnv = agentEnv.extend({
  SERVICE_NAME: z.string().min(1).default("agent-consumer"),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

/** The parsed consumer environment. */
export type AgentConsumerEnv = z.output<typeof agentConsumerEnv>;

/** The configuration of the consumer process; it also provides {@link AgentConfig}. */
export abstract class AgentConsumerConfig extends AgentConfig {
  abstract readonly rabbitmqUrl: string;
}

/**
 * @param env the result of `loadConfig(agentConsumerEnv)`.
 * @returns the consumer configuration.
 */
export function toAgentConsumerConfig(env: AgentConsumerEnv): AgentConsumerConfig {
  return { ...toAgentConfig(env), rabbitmqUrl: env.RABBITMQ_URL };
}
