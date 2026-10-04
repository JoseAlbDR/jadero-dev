import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { ApiConfig } from "../../config/api-config.js";
import { PG_POOL } from "./postgres.tokens.js";

/**
 * Closes the pool after the HTTP server has closed, so requests still in flight during a
 * graceful shutdown can finish their queries.
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
 * `api`'s Postgres connection (driver `pg`, WP-3 decision D1; WP-10 adds Drizzle on top).
 * The pool connects lazily, so the app boots while the database is down and readiness says so.
 * `HealthModule` imports this module to build `PostgresReadinessCheck`.
 */
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: ApiConfig) =>
        // query_timeout frees the connection when a readiness check times out.
        new Pool({
          connectionString: config.databaseUrl,
          max: 2,
          connectionTimeoutMillis: 1000,
          query_timeout: 1000,
        }),
      inject: [ApiConfig],
    },
    PoolCloser,
  ],
  exports: [PG_POOL],
})
export class PostgresModule {}
