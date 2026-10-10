import { createPool, drizzleOn } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import type { Pool } from "pg";
import { ContentQueries } from "./application/content-queries.js";
import {
  CONTENT_READER_POOL,
  ContentReaderPoolCloser,
} from "./infrastructure/content-reader-pool.js";
import { DrizzleContentQueries } from "./infrastructure/drizzle-content-queries.js";
import { LocalizedContentController } from "./presentation/localized-content.controller.js";
import { WorkLogController } from "./presentation/work-log.controller.js";

/** The read-only connection the public reads use: `DATABASE_READ_URL` and the pool size. */
export interface ContentReaderOptions {
  /** Connects as `content_reader`. Never logged. */
  readonly url: string;
  readonly poolMax: number;
}

/**
 * The public read side of the content module (CQRS, WP-12 step 7): the `/v1/content` controllers
 * and the query service on its own `pg` pool, logged in as the read-only `content_reader` role, so
 * least privilege rests on a credential: an injected statement cannot write, nor read a table the
 * migration did not grant (never `knowledge_entry_provenance`). Separate from `ContentModule`,
 * whose write use cases run on the owner pool and are also booted by `db:seed`, which needs no
 * reader. The pool connects lazily (like `DatabaseModule`'s) and closes after the HTTP server.
 * It is exported for `ContentReaderReadinessCheck`: pass the same `forRoot` result to
 * `HealthModule.forRoot({ imports })`, so both share one module instance and one pool.
 */
@Module({})
export class PublicContentModule {
  /**
   * @param reader the read-only connection, from `ApiConfig`.
   * @returns the module with the public controllers, the query service and its pool.
   */
  static forRoot(reader: ContentReaderOptions): DynamicModule {
    return {
      module: PublicContentModule,
      controllers: [LocalizedContentController, WorkLogController],
      providers: [
        { provide: CONTENT_READER_POOL, useFactory: () => createPool(reader) },
        ContentReaderPoolCloser,
        {
          provide: ContentQueries,
          useFactory: (pool: Pool) => new DrizzleContentQueries(drizzleOn(pool)),
          inject: [CONTENT_READER_POOL],
        },
      ],
      exports: [CONTENT_READER_POOL],
    };
  }
}
