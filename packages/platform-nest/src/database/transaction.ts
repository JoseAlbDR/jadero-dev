import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { Database } from "./database.tokens.js";

/**
 * The result of a raw query, reduced to what callers read. Structurally the same as
 * `@jadero/messaging`'s `SqlResult`, which this package must not import (bootstrap only).
 */
export interface QueryResultShape<R> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

/**
 * Runs raw SQL with parameters on the transaction's connection. Structurally the same as
 * `@jadero/messaging`'s `SqlExecutor`, so `addToOutbox` and `recordInInbox` accept it as is.
 * It has no `release`: the transaction helper owns the connection's lifetime.
 */
export interface QueryExecutor {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResultShape<R>>;
}

/** What {@link withTransaction} hands the work: Drizzle and a raw executor, both on one connection. */
export interface TransactionScope<TSchema extends Record<string, unknown> = Record<string, never>> {
  /** Drizzle bound to the transaction's connection. Do not call `db.transaction()` on it. */
  readonly db: Database<TSchema>;
  /** The same connection for raw SQL (the outbox and inbox writes of `@jadero/messaging`). */
  readonly executor: QueryExecutor;
}

/** The one thing the helper needs from a pool: check out a client (`pg.Pool` is one). */
export interface ConnectionSource {
  connect(): Promise<PoolClient>;
}

/** Options of {@link withTransaction}. */
export interface TransactionOptions<TSchema extends Record<string, unknown>> {
  /** The service's table definitions, as passed to `DatabaseModule.forRoot`. */
  readonly schema?: TSchema;
}

/**
 * Builds Drizzle on a pool or one checked-out client with the options every service shares.
 * `DatabaseModule`'s `DRIZZLE` provider and {@link withTransaction} both use it, so a query reads
 * the same column names inside and outside a transaction.
 * @param client the pool, or a client checked out of it.
 * @param schema the service's table definitions, if it passes them.
 * @returns the Drizzle instance.
 */
export function drizzleOn<TSchema extends Record<string, unknown> = Record<string, never>>(
  client: Pool | PoolClient,
  schema?: TSchema,
): Database<TSchema> {
  return drizzle<TSchema, Pool | PoolClient>({
    client,
    // Must match drizzle.config.ts, or queries use the wrong column names.
    casing: "snake_case",
    ...(schema ? { schema } : {}),
  });
}

/**
 * Runs `work` in one Postgres transaction on one pooled connection (unit of work, WP-10 D6 and
 * Q2 B): checks out a client, `BEGIN`, hands `work` Drizzle and a raw executor bound to that
 * client, then `COMMIT` when `work` resolves, or `ROLLBACK` and rethrow when it throws. The client
 * always goes back to the pool; when the rollback itself fails, it is released with that error so
 * `pg` destroys the broken connection instead of reusing it. The isolation level is Postgres's
 * default, `READ COMMITTED`.
 * @param pool the service's pool (`PG_POOL`).
 * @param work the use case's writes; everything in it must use the scope, never the pool.
 * @param options the service's schema, for Drizzle's relational query API.
 * @returns what `work` returned.
 */
export async function withTransaction<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  pool: ConnectionSource,
  work: (scope: TransactionScope<TSchema>) => Promise<T>,
  options: TransactionOptions<TSchema> = {},
): Promise<T> {
  const client = await pool.connect();
  const executor: QueryExecutor = {
    query: async <R>(text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows as R[], rowCount: result.rowCount };
    },
  };
  try {
    await client.query("BEGIN");
    const result = await work({ db: drizzleOn<TSchema>(client, options.schema), executor });
    await client.query("COMMIT");
    client.release();
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
      client.release();
    } catch (rollbackError) {
      client.release(rollbackError instanceof Error ? rollbackError : true);
    }
    throw error;
  }
}
