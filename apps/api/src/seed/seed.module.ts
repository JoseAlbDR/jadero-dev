import { DatabaseModule } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  ContentModule,
  type ContentSeedItem,
  SeedContent,
  type SeedReport,
} from "../modules/content/index.js";

/** Where the seed writes: `api`'s own database (ADR-029) and its pool size. */
export interface SeedDatabase {
  /** The connection string; never logged. */
  readonly url: string;
  readonly poolMax: number;
}

/**
 * The seed's application context: the database pool and the content module, nothing else (no
 * HTTP server, no health checks, no telemetry), so a seed run opens no port.
 */
@Module({})
export class SeedModule {
  /**
   * @param database the database to seed.
   * @returns the module with the global pool and the content use cases.
   */
  static forRoot(database: SeedDatabase): DynamicModule {
    return {
      module: SeedModule,
      imports: [DatabaseModule.forRoot(database), ContentModule],
    };
  }
}

/**
 * Boots a Nest application context without HTTP, seeds the items through `SeedContent`, and
 * closes the context, which closes the pool.
 * @param database the database to seed.
 * @param items the seed data.
 * @returns per type, the items created and the items skipped.
 * @throws whatever `SeedContent` throws; the context is closed first.
 */
export async function runSeed(
  database: SeedDatabase,
  items: readonly ContentSeedItem[],
): Promise<SeedReport> {
  const app = await NestFactory.createApplicationContext(SeedModule.forRoot(database), {
    logger: ["error", "warn"],
  });
  try {
    return await app.get(SeedContent).execute(items);
  } finally {
    await app.close();
  }
}
