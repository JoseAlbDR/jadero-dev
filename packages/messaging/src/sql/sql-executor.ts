/** The result shape of a query: what `pg` returns, reduced to what messaging reads. */
export interface SqlResult<R> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

/**
 * The one thing messaging needs from a database connection: run SQL with parameters (WP-5
 * decision S1). A `pg.PoolClient` already is one; in WP-10 a small adapter makes a Drizzle
 * transaction one. Passing the caller's executor is how an outbox row joins the caller's
 * transaction.
 */
export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<R>>;
}

/** A pooled connection, released after use (`pg.PoolClient`). */
export interface SqlClient extends SqlExecutor {
  release(error?: Error | boolean): void;
}

/** A connection pool (`pg.Pool`). */
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

/**
 * Runs `work` in one transaction on a pooled connection: commit when it resolves, roll back and
 * rethrow when it throws.
 * @param pool the service's pool.
 * @param work what to run; receives the transaction's executor.
 * @returns what `work` returned.
 */
export async function inTransaction<T>(
  pool: SqlPool,
  work: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    client.release();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release(true);
    throw error;
  }
}
