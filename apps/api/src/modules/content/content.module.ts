import { Module } from "@nestjs/common";
import { Clock } from "./application/clock.js";
import { ContentUnitOfWork } from "./application/content.unit-of-work.js";
import { IdGenerator } from "./application/id-generator.js";
import { ApproveKnowledgeEntry } from "./application/use-cases/approve-knowledge-entry.use-case.js";
import { ArchiveContentItem } from "./application/use-cases/archive-content-item.use-case.js";
import { CreateContentItem } from "./application/use-cases/create-content-item.use-case.js";
import { CreateKnowledgeEntry } from "./application/use-cases/create-knowledge-entry.use-case.js";
import { DeleteKnowledgeEntry } from "./application/use-cases/delete-knowledge-entry.use-case.js";
import { PublishContentItem } from "./application/use-cases/publish-content-item.use-case.js";
import { RequestKnowledgeEntryChanges } from "./application/use-cases/request-knowledge-entry-changes.use-case.js";
import { SaveContentRevision } from "./application/use-cases/save-content-revision.use-case.js";
import { SaveKnowledgeEntryRevision } from "./application/use-cases/save-knowledge-entry-revision.use-case.js";
import { SeedContent } from "./application/use-cases/seed-content.use-case.js";
import { SubmitKnowledgeEntry } from "./application/use-cases/submit-knowledge-entry.use-case.js";
import { WithdrawKnowledgeEntry } from "./application/use-cases/withdraw-knowledge-entry.use-case.js";
import { DrizzleContentUnitOfWork } from "./infrastructure/drizzle-content.unit-of-work.js";
import { SystemClock } from "./infrastructure/system-clock.js";
import { UuidV7IdGenerator } from "./infrastructure/uuid-v7-id-generator.js";

/** The write use cases, which WP-13's admin controllers will call behind their guard (Q2 A). */
const useCases = [
  CreateContentItem,
  SaveContentRevision,
  PublishContentItem,
  ArchiveContentItem,
  CreateKnowledgeEntry,
  SaveKnowledgeEntryRevision,
  SubmitKnowledgeEntry,
  RequestKnowledgeEntryChanges,
  ApproveKnowledgeEntry,
  WithdrawKnowledgeEntry,
  DeleteKnowledgeEntry,
  SeedContent,
];

/**
 * The content module (ADR-003, hexagonal; ADR-011, ADR-031). This wiring is the only place that
 * knows which adapter backs each port: the Drizzle unit of work on the global pool of
 * `DatabaseModule` (imported once by the root module), the system clock and UUIDv7 ids. No
 * controller yet: the public reads arrive in step 7, the admin writes with WP-13 (Q2 A).
 */
@Module({
  providers: [
    ...useCases,
    { provide: ContentUnitOfWork, useClass: DrizzleContentUnitOfWork },
    { provide: Clock, useClass: SystemClock },
    { provide: IdGenerator, useClass: UuidV7IdGenerator },
  ],
  exports: useCases,
})
export class ContentModule {}
