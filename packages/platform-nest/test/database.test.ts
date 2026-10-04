import { Inject, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  DatabaseModule,
  poolConfig,
  QUERY_TIMEOUT_MS,
} from "../src/database/database.module.js";
import { type Database, DRIZZLE, PG_POOL } from "../src/database/database.tokens.js";
import { PostgresReadinessCheck } from "../src/database/postgres.readiness-check.js";
import { CHECK_TIMEOUT_MS } from "../src/health/health.controller.js";
import { HealthModule } from "../src/health/health.module.js";

// Nothing listens on port 1: the module must still boot, because the pool connects lazily.
const URL = "postgres://probe:probe@127.0.0.1:1/probe_test";

/** A provider in a feature module that injects both tokens without importing DatabaseModule. */
@Injectable()
class NeedsDatabase {
  constructor(
    @Inject(PG_POOL) readonly pool: Pool,
    @Inject(DRIZZLE) readonly db: Database,
  ) {}
}

@Module({ providers: [NeedsDatabase] })
class FeatureModule {}

describe("DatabaseModule", () => {
  async function boot() {
    return Test.createTestingModule({
      imports: [
        DatabaseModule.forRoot({ url: URL, poolMax: 3 }),
        HealthModule.forRoot({ checks: [PostgresReadinessCheck] }),
        FeatureModule,
      ],
    }).compile();
  }

  it("boots without a database and resolves the pool and Drizzle over that pool", async () => {
    const moduleRef = await boot();
    const pool = moduleRef.get<Pool>(PG_POOL);
    const db = moduleRef.get<Database>(DRIZZLE);
    expect(pool).toBeInstanceOf(Pool);
    expect(db).toBeInstanceOf(NodePgDatabase);
    expect((db as unknown as { $client: Pool }).$client).toBe(pool);
    expect(pool.totalCount).toBe(0);
    await moduleRef.close();
  });

  it("is global: a feature module injects both tokens without importing it", async () => {
    const moduleRef = await boot();
    const feature = moduleRef.get(NeedsDatabase);
    expect(feature.pool).toBe(moduleRef.get(PG_POOL));
    expect(feature.db).toBe(moduleRef.get(DRIZZLE));
    await moduleRef.close();
  });

  it("gives application queries 5 s and keeps the 1 s connect budget", () => {
    expect(poolConfig({ url: URL, poolMax: 4 })).toEqual({
      connectionString: URL,
      max: 4,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    });
    expect(QUERY_TIMEOUT_MS).toBe(5000);
    expect(CONNECT_TIMEOUT_MS).toBe(1000);
  });

  it("builds the pool from the options", async () => {
    const moduleRef = await boot();
    const pool = moduleRef.get<Pool>(PG_POOL);
    expect(pool.options).toMatchObject({ max: 3, query_timeout: QUERY_TIMEOUT_MS });
    await moduleRef.close();
  });

  it("closes the pool on shutdown", async () => {
    const moduleRef = await boot();
    const pool = moduleRef.get<Pool>(PG_POOL);
    await moduleRef.close();
    expect(pool.ended).toBe(true);
  });

  it("runs the readiness check with its own 1 s budget, not the 5 s one", async () => {
    const moduleRef = await boot();
    const pool = moduleRef.get<Pool>(PG_POOL);
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [] } as never);
    await moduleRef.get(PostgresReadinessCheck).check();
    expect(query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: CHECK_TIMEOUT_MS });
    expect(CHECK_TIMEOUT_MS).toBe(1000);
    await moduleRef.close();
  });

  it("fails the readiness check when nothing answers", async () => {
    const moduleRef = await boot();
    await expect(moduleRef.get(PostgresReadinessCheck).check()).rejects.toThrow();
    await moduleRef.close();
  });
});
