import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { type Database, DRIZZLE, PG_POOL } from "./database.tokens.js";

/** How long an application query may run before `pg` cancels it on the client side. */
export const QUERY_TIMEOUT_MS = 5000;

/** How long a caller waits to open a connection or to get one from a full pool. */
export const CONNECT_TIMEOUT_MS = 1000;

/** What a service passes: its own database and pool size, from its validated config (ADR-043). */
export interface DatabaseModuleOptions<
  TSchema extends Record<string, unknown> = Record<string, never>,
> {
  /** Connection string of the service's own database (ADR-029 rule 1). Never logged. */
  readonly url: string;
  /** Most connections the pool opens at once. */
  readonly poolMax: number;
  /** The service's table definitions, for Drizzle's relational query API; optional. */
  readonly schema?: TSchema;
}

/**
 * The pool settings every service shares; only the URL and the size differ.
 * @param options the service's database options.
 * @returns the `pg` pool configuration.
 */
export function poolConfig(options: Pick<DatabaseModuleOptions, "url" | "poolMax">): PoolConfig {
  return {
    connectionString: options.url,
    max: options.poolMax,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  };
}

/**
 * Closes the pool after the HTTP server has closed, so requests still in flight during a
 * graceful shutdown can finish their queries (WP-3 "Lifecycle and graceful shutdown").
 */
@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Nest lifecycle hook: the last one, after the HTTP server closed. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * A service's connection to its own database (ADR-005, WP-10 Q1 A): one `pg` pool (driver `pg`,
 * WP-3 decision D1) and Drizzle over it, as the DI tokens `PG_POOL` and `DRIZZLE`. The pool
 * connects lazily, so the app boots while the database is down and readiness says so. Global: the
 * root module imports it once and every feature module and `HealthModule` can inject both tokens.
 */
@Module({})
export class DatabaseModule {
  /**
   * @param options the service's database URL, pool size and optional Drizzle schema.
   * @returns a global module that provides and exports `PG_POOL` and `DRIZZLE`.
   */
  static forRoot<TSchema extends Record<string, unknown> = Record<string, never>>(
    options: DatabaseModuleOptions<TSchema>,
  ): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: PG_POOL, useFactory: () => new Pool(poolConfig(options)) },
        {
          provide: DRIZZLE,
          useFactory: (pool: Pool): Database<TSchema> =>
            drizzle<TSchema>({
              client: pool,
              // Must match drizzle.config.ts, or queries use the wrong column names.
              casing: "snake_case",
              ...(options.schema ? { schema: options.schema } : {}),
            }),
          inject: [PG_POOL],
        },
        PoolCloser,
      ],
      exports: [PG_POOL, DRIZZLE],
    };
  }
}
