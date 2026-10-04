import type { z } from "zod";

/** One problem with one environment variable. Holds the name, never the received value. */
export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** Thrown by {@link parseConfig} when the environment does not match the schema. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`Invalid configuration: ${issues.map((issue) => issue.variable).join(", ")}`);
    this.name = "ConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Validates the environment against a Zod schema and returns the parsed, typed object.
 * Issues name the variable and the problem, never the value, because a value may be a secret
 * (ADR-007).
 * @param schema the service's environment schema, usually `platformEnv.extend({...})`.
 * @param env the environment to read, normally `process.env`.
 * @returns the parsed configuration, with defaults applied and strings coerced.
 * @throws {ConfigError} when any variable is missing or malformed.
 */
export function parseConfig<S extends z.ZodType>(schema: S, env: Env): z.output<S> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.join(".") : "(environment)",
      message: issue.message,
    })),
  );
}

/** Where {@link loadConfig} reports and how it stops; tests replace both. */
export interface LoadConfigIo {
  readonly write: (line: string) => void;
  readonly exit: (code: number) => never;
}

const processIo: LoadConfigIo = {
  write: (line) => process.stderr.write(`${line}\n`),
  exit: (code) => process.exit(code),
};

/**
 * Fail-fast boot: parses the environment, or prints one line per bad variable and exits with
 * code 1 before any Nest module is built. Call it first in `main.ts`.
 * @param schema the service's environment schema.
 * @param env the environment to read; defaults to `process.env`, the only place it is read.
 * @param io output and exit, replaceable in tests.
 * @returns the parsed configuration.
 */
export function loadConfig<S extends z.ZodType>(
  schema: S,
  env: Env = process.env,
  io: LoadConfigIo = processIo,
): z.output<S> {
  try {
    return parseConfig(schema, env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.write("Invalid configuration, refusing to start:");
    for (const issue of error.issues) io.write(`  ${issue.variable}: ${issue.message}`);
    return io.exit(1);
  }
}
