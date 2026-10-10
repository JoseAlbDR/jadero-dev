import { Inject, Injectable, type Type } from "@nestjs/common";
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
 * Readiness of one `pg` pool: one `SELECT 1` through it. Not injectable on its own: build a check
 * for a pool with {@link postgresReadinessCheck}.
 */
export class PoolReadinessCheck extends ReadinessCheck {
  /**
   * @param name the key in the health body.
   * @param pool the pool to check.
   */
  constructor(
    readonly name: string,
    private readonly pool: Pool,
  ) {
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

/**
 * Builds the readiness check of the `pg` pool under a DI token, reported under `name` on
 * `/health/ready`. A service with a second pool (api's read-only `content_reader` pool) registers
 * one check per pool, so a wrong credential on either fails readiness instead of every request
 * that uses it. Extend the result to give the check its own class name:
 * `class ReaderCheck extends postgresReadinessCheck(READER_POOL, "reader") {}`.
 * @param poolToken the DI token of the pool.
 * @param name the key in the health body.
 * @returns an injectable check class for `HealthModule.forRoot({ checks })`.
 */
export function postgresReadinessCheck(
  poolToken: symbol | string,
  name: string,
): Type<PoolReadinessCheck> {
  @Injectable()
  class TokenPoolReadinessCheck extends PoolReadinessCheck {
    constructor(@Inject(poolToken) pool: Pool) {
      super(name, pool);
    }
  }
  return TokenPoolReadinessCheck;
}

/**
 * Readiness of the service's own database through `DatabaseModule`'s pool, as `database`. Register
 * it with `HealthModule.forRoot({ checks: [PostgresReadinessCheck] })` next to
 * `DatabaseModule.forRoot`.
 */
export class PostgresReadinessCheck extends postgresReadinessCheck(PG_POOL, "database") {}
