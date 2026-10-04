import { ReadinessCheck } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./postgres.tokens.js";

/** Readiness of `agent`'s database: one `SELECT 1` through the pool. */
@Injectable()
export class PostgresReadinessCheck extends ReadinessCheck {
  readonly name = "database";

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  /** Resolves when Postgres answers; the health controller applies the timeout. */
  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
