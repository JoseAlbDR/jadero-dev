import { Inject, Injectable, type Type } from "@nestjs/common";
import type { Pool, QueryConfig } from "pg";
import { CHECK_TIMEOUT_MS } from "../health/health.controller.js";
import { ReadinessCheck } from "../health/readiness-check.js";
import { PG_POOL } from "./database.tokens.js";

/** The default probe: proves the pool can log in and run a statement, nothing about tables. */
const DEFAULT_READINESS_PROBE = "SELECT 1";

/** Options of {@link postgresReadinessCheck}. */
export interface PoolReadinessOptions {
  /**
   * The statement the check runs, default {@link DEFAULT_READINESS_PROBE}. A pool whose role only
   * reads granted tables passes a probe on one of them, such as
   * `SELECT 1 FROM content.profile_translations LIMIT 0`: Postgres checks the table exists and the
   * role holds `SELECT` on it before it plans the zero rows, so a missing migration or grant fails
   * readiness. A fixed string from code, never request input.
   */
  readonly probe?: string;
}

/**
 * Readiness of one `pg` pool: one probe statement through it (`SELECT 1` by default). Not
 * injectable on its own: build a check for a pool with {@link postgresReadinessCheck}.
 */
export class PoolReadinessCheck extends ReadinessCheck {
  // `pg` reads a per-query `query_timeout` (lib/client.js); `@types/pg` does not declare it.
  private readonly query: QueryConfig & { query_timeout: number };

  /**
   * @param name the key in the health body.
   * @param pool the pool to check.
   * @param probe the statement to run, default {@link DEFAULT_READINESS_PROBE}.
   */
  constructor(
    readonly name: string,
    private readonly pool: Pool,
    probe: string = DEFAULT_READINESS_PROBE,
  ) {
    super();
    this.query = { text: probe, query_timeout: CHECK_TIMEOUT_MS };
  }

  /**
   * Resolves when Postgres answers. The health controller gives up after `CHECK_TIMEOUT_MS`; the
   * query carries the same budget, so a hung check frees its connection then, not after the pool's
   * longer timeout for application queries.
   */
  async check(): Promise<void> {
    await this.pool.query(this.query);
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
 * @param options the probe statement; the default `SELECT 1` proves only the login.
 * @returns an injectable check class for `HealthModule.forRoot({ checks })`.
 */
export function postgresReadinessCheck(
  poolToken: symbol | string,
  name: string,
  options: PoolReadinessOptions = {},
): Type<PoolReadinessCheck> {
  @Injectable()
  class TokenPoolReadinessCheck extends PoolReadinessCheck {
    constructor(@Inject(poolToken) pool: Pool) {
      super(name, pool, options.probe);
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
