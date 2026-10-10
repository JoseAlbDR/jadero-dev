import { Inject, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  createPool,
  DatabaseModule,
  poolConfig,
  QUERY_TIMEOUT_MS,
} from "../src/database/database.module.js";
import { type Database, DRIZZLE, PG_POOL } from "../src/database/database.tokens.js";
import {
  PostgresReadinessCheck,
  postgresReadinessCheck,
} from "../src/database/postgres.readiness-check.js";
import { CHECK_TIMEOUT_MS, READINESS_CHECKS } from "../src/health/health.controller.js";
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

  it("builds a check for a second pool under its own token and name", async () => {
    const READER_POOL = Symbol("READER_POOL");
    class ReaderCheck extends postgresReadinessCheck(READER_POOL, "reader") {}
    const reader = {
      query: vi.fn().mockRejectedValue(new Error("password authentication failed")),
    };
    // The module that provides the pool is imported where the checks live, as api does.
    @Module({ providers: [{ provide: READER_POOL, useValue: reader }], exports: [READER_POOL] })
    class ReaderModule {}
    const withReader = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRoot({ url: URL, poolMax: 1 }),
        HealthModule.forRoot({
          checks: [PostgresReadinessCheck, ReaderCheck],
          imports: [ReaderModule],
        }),
      ],
    }).compile();
    const checks = withReader.get<{ name: string }[]>(READINESS_CHECKS);
    expect(checks.map((check) => check.name)).toEqual(["database", "reader"]);
    await expect(withReader.get(ReaderCheck).check()).rejects.toThrow("password");
    expect(reader.query).toHaveBeenCalledWith({
      text: "SELECT 1",
      query_timeout: CHECK_TIMEOUT_MS,
    });
    await withReader.close();
  });

  it("survives an idle client's error: warns with the code only, never the message", async () => {
    const warn = vi.fn();
    const pool = createPool({ url: URL, poolMax: 1 }, { warn });
    const error = Object.assign(
      new Error("terminating connection due to administrator command at 10.0.0.5 for probe"),
      { code: "57P01" },
    );
    expect(() => pool.emit("error", error)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({ code: "57P01" }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("10.0.0.5");
    await pool.end();
  });

  it("logs an unknown code when the error has none", async () => {
    const warn = vi.fn();
    const pool = createPool({ url: URL, poolMax: 1 }, { warn });
    pool.emit("error", new Error("socket hang up"));
    expect(warn).toHaveBeenCalledWith({ code: "unknown" }, expect.any(String));
    await pool.end();
  });

  it("gives the module's pool the listener, so an idle error does not crash the process", async () => {
    const moduleRef = await boot();
    const pool = moduleRef.get<Pool>(PG_POOL);
    expect(pool.listenerCount("error")).toBe(1);
    expect(() =>
      pool.emit("error", Object.assign(new Error("x"), { code: "ECONNRESET" })),
    ).not.toThrow();
    await moduleRef.close();
  });
});
