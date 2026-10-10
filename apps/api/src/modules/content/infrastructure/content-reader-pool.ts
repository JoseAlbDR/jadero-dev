import { postgresReadinessCheck } from "@jadero/platform-nest";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

/**
 * The DI token of the `content_reader` pool: a second `pg` pool to api's own database, logged in as
 * the read-only role (WP-12 step 7), used only by the content query service. The owner pool of
 * `DatabaseModule` (`PG_POOL`) keeps every write.
 */
export const CONTENT_READER_POOL = Symbol("CONTENT_READER_POOL");

/**
 * Closes the reader pool after the HTTP server has closed, like platform-nest's closer of the owner
 * pool, so reads in flight during a graceful shutdown finish first.
 */
@Injectable()
export class ContentReaderPoolCloser implements OnApplicationShutdown {
  constructor(@Inject(CONTENT_READER_POOL) private readonly pool: Pool) {}

  /** Nest lifecycle hook: the last one, after the HTTP server closed. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * The reader's readiness probe: a table every page reads (the profile), granted by migration 0002.
 * `LIMIT 0` reads no row, but Postgres still checks the table exists and the role holds `SELECT`
 * on it, so a missing migration or grant fails readiness, not only a refused login.
 */
const CONTENT_READER_PROBE = "SELECT 1 FROM content.profile_translations LIMIT 0";

/**
 * Readiness of the reader pool, as `content-reader` on `/health/ready` (WP-12 step 7b): a wrong
 * `DATABASE_READ_URL` password, migration 0002 not applied or a missing grant fails readiness, so
 * the instance gets no traffic, instead of passing it and answering 500 on every public read.
 */
export class ContentReaderReadinessCheck extends postgresReadinessCheck(
  CONTENT_READER_POOL,
  "content-reader",
  { probe: CONTENT_READER_PROBE },
) {}
