import { Injectable } from "@nestjs/common";
import { type ContentScope, ContentUnitOfWork } from "../application/content.unit-of-work.js";
import type { KnowledgeEntryRecord } from "./in-memory-knowledge-entry.repository.js";
import { InMemoryKnowledgeEntryRepository } from "./in-memory-knowledge-entry.repository.js";
import type { ProjectRecord } from "./in-memory-project.repository.js";
import { InMemoryProjectRepository } from "./in-memory-project.repository.js";
import { InMemoryRecords, StagedRecords } from "./in-memory-records.js";

/**
 * The fakes' storage, one table per aggregate type, shared by the in-memory unit of work and the
 * repositories bound outside it, so a read outside `run` sees what `run` committed.
 */
@Injectable()
export class InMemoryContentStore {
  readonly projects = new InMemoryRecords<ProjectRecord>();
  readonly knowledgeEntries = new InMemoryRecords<KnowledgeEntryRecord>();
}

/**
 * The fake unit of work (ADR-009): `work` runs on staged views of every table, applied in one
 * synchronous step only when `work` resolves and no staged item changed meanwhile, and dropped when
 * it throws. Passes the same contract suite as `DrizzleContentUnitOfWork`.
 */
@Injectable()
export class InMemoryContentUnitOfWork extends ContentUnitOfWork {
  constructor(private readonly store: InMemoryContentStore) {
    super();
  }

  /**
   * Runs `work` on staged writes; commits them when it resolves, discards them when it throws.
   * @param work the use case's reads-for-writing and writes.
   * @returns what `work` returned, after the commit.
   * @throws {ConcurrentModification} at commit, when another unit of work committed a staged item.
   */
  async run<T>(work: (scope: ContentScope) => Promise<T>): Promise<T> {
    const projects = new StagedRecords(this.store.projects);
    const knowledgeEntries = new StagedRecords(this.store.knowledgeEntries);
    const result = await work({
      projects: new InMemoryProjectRepository(projects),
      knowledgeEntries: new InMemoryKnowledgeEntryRepository(knowledgeEntries),
    });
    const tables = [projects, knowledgeEntries];
    for (const table of tables) table.check();
    for (const table of tables) table.commit();
    return result;
  }
}
