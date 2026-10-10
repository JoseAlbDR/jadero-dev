import { type ConnectionSource, PG_POOL, withTransaction } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { type ContentScope, ContentUnitOfWork } from "../application/content.unit-of-work.js";
import { DrizzleCvBulletRepository } from "./drizzle-cv-bullet.repository.js";
import { DrizzleExperienceItemRepository } from "./drizzle-experience-item.repository.js";
import { DrizzleKnowledgeEntryRepository } from "./drizzle-knowledge-entry.repository.js";
import { DrizzlePostRepository } from "./drizzle-post.repository.js";
import { DrizzleProfileRepository } from "./drizzle-profile.repository.js";
import { DrizzleProjectRepository } from "./drizzle-project.repository.js";
import { DrizzleSkillRepository } from "./drizzle-skill.repository.js";

/**
 * The real unit of work (WP-10 D6): platform-nest's `withTransaction` checks out one connection and
 * sends `BEGIN`; this class builds every scope repository on that connection's Drizzle, so a version
 * conflict thrown by one save rolls back the revisions another save of the same run inserted
 * (Trace 2b). `withTransaction` sends `COMMIT` or `ROLLBACK`. No Drizzle schema is passed: the
 * repositories use only the query builder.
 */
@Injectable()
export class DrizzleContentUnitOfWork extends ContentUnitOfWork {
  constructor(@Inject(PG_POOL) private readonly pool: ConnectionSource) {
    super();
  }

  /**
   * Runs `work` in one Postgres transaction with transaction-bound repositories.
   * @param work the use case's reads-for-writing and writes.
   * @returns what `work` returned, after `COMMIT`.
   */
  run<T>(work: (scope: ContentScope) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, ({ db }) =>
      work({
        profile: new DrizzleProfileRepository(db),
        experienceItems: new DrizzleExperienceItemRepository(db),
        projects: new DrizzleProjectRepository(db),
        posts: new DrizzlePostRepository(db),
        skills: new DrizzleSkillRepository(db),
        cvBullets: new DrizzleCvBulletRepository(db),
        knowledgeEntries: new DrizzleKnowledgeEntryRepository(db),
      }),
    );
  }
}
