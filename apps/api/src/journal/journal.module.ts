import { DatabaseModule } from "@jadero/platform-nest";
import { type DynamicModule, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ContentModule, ImportJournalPost, PublishJournalPost } from "../modules/content/index.js";
import {
  importJournalFiles,
  type JournalArgs,
  type JournalOutput,
  publishJournal,
  readJournalFiles,
} from "./journal-commands.js";

/** Where the journal commands write: `api`'s own database (ADR-029) and its pool size. */
export interface JournalDatabase {
  /** The connection string; never logged. */
  readonly url: string;
  readonly poolMax: number;
}

/**
 * The journal commands' application context, the same shape as the seed's: the database pool and
 * the content module, nothing else (no HTTP server, no health checks, no telemetry), so a run opens
 * no port.
 */
@Module({})
export class JournalModule {
  /**
   * @param database the database to write.
   * @returns the module with the global pool and the content use cases.
   */
  static forRoot(database: JournalDatabase): DynamicModule {
    return {
      module: JournalModule,
      imports: [DatabaseModule.forRoot(database), ContentModule],
    };
  }
}

/**
 * Runs one journal command (WP-39 D3): `import` reads the drafts first (a missing folder fails
 * before any connection), then boots a Nest application context without HTTP and imports each file;
 * `publish` boots it and publishes one work package. The context is closed at the end, which closes
 * the pool.
 * @param args the parsed command line.
 * @param database the database to write.
 * @param output where the lines go.
 * @returns true when every file imported or the publish ran; false when any file was refused or
 * failed, or the publish was refused.
 * @throws when the drafts folder cannot be read or the context cannot boot.
 */
export async function runJournal(
  args: JournalArgs,
  database: JournalDatabase,
  output: JournalOutput,
): Promise<boolean> {
  const files = args.command === "import" ? await readJournalFiles(args.dir) : [];
  const app = await NestFactory.createApplicationContext(JournalModule.forRoot(database), {
    logger: ["error", "warn"],
  });
  try {
    if (args.command === "import") {
      if (files.length === 0) output.info(`journal: no drafts in ${args.dir}`);
      return (await importJournalFiles(files, app.get(ImportJournalPost), output)) === 0;
    }
    return await publishJournal(args.wp, args.locales, app.get(PublishJournalPost), output);
  } finally {
    await app.close();
  }
}
