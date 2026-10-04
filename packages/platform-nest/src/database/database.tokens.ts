import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** The DI token for the service's `pg` pool to its own database (ADR-029 rule 1). */
export const PG_POOL = Symbol("PG_POOL");

/** The DI token for the Drizzle instance over {@link PG_POOL} (ADR-005). */
export const DRIZZLE = Symbol("DRIZZLE");

/**
 * The type of what {@link DRIZZLE} resolves to: Drizzle over `node-postgres`. `TSchema` is the
 * service's table definitions when it passes them, for Drizzle's relational query API.
 */
export type Database<TSchema extends Record<string, unknown> = Record<string, never>> =
  NodePgDatabase<TSchema>;
