import { Inject, Injectable } from "@nestjs/common";
import type { Pool, QueryConfig } from "pg";
import { CHECK_TIMEOUT_MS } from "../health/health.controller.js";
import { ReadinessCheck } from "../health/readiness-check.js";
import { PG_POOL } from "./database.tokens.js";

// `pg` reads a per-query `query_timeout` (lib/client.js); `@types/pg` does not declare it.
const SELECT_ONE: QueryConfig & { query_timeout: number } = {
  text: "SELECT 1",
  query_timeout: CHECK_TIMEOUT_MS,
};

/**
 * Readiness of the service's own database: one `SELECT 1` through the pool. Register it with
 * `HealthModule.forRoot({ checks: [PostgresReadinessCheck] })` next to `DatabaseModule.forRoot`.
 */
@Injectable()
export class PostgresReadinessCheck extends ReadinessCheck {
  readonly name = "database";

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  /**
   * Resolves when Postgres answers. The health controller gives up after `CHECK_TIMEOUT_MS`; the
   * query carries the same budget, so a hung check frees its connection then, not after the pool's
   * longer timeout for application queries.
   */
  async check(): Promise<void> {
    await this.pool.query(SELECT_ONE);
  }
}
