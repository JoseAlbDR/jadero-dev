import { Injectable } from "@nestjs/common";
import { type ContentScope, ContentUnitOfWork } from "../application/content.unit-of-work.js";
import {
  type CvBulletRecord,
  InMemoryCvBulletRepository,
} from "./in-memory-cv-bullet.repository.js";
import {
  type ExperienceItemRecord,
  InMemoryExperienceItemRepository,
} from "./in-memory-experience-item.repository.js";
import type { KnowledgeEntryRecord } from "./in-memory-knowledge-entry.repository.js";
import { InMemoryKnowledgeEntryRepository } from "./in-memory-knowledge-entry.repository.js";
import { InMemoryPostRepository, type PostRecord } from "./in-memory-post.repository.js";
import { InMemoryProfileRepository, profileRecords } from "./in-memory-profile.repository.js";
import type { ProjectRecord } from "./in-memory-project.repository.js";
import { InMemoryProjectRepository } from "./in-memory-project.repository.js";
import { InMemoryRecords, StagedRecords } from "./in-memory-records.js";
import { InMemorySkillRepository, type SkillRecord } from "./in-memory-skill.repository.js";

/**
 * The fakes' storage, one table per aggregate type, shared by the in-memory unit of work and the
 * repositories bound outside it, so a read outside `run` sees what `run` committed.
 */
@Injectable()
export class InMemoryContentStore {
  readonly profile = profileRecords();
  readonly experienceItems = new InMemoryRecords<ExperienceItemRecord>();
  readonly projects = new InMemoryRecords<ProjectRecord>();
  readonly posts = new InMemoryRecords<PostRecord>();
  readonly skills = new InMemoryRecords<SkillRecord>();
  readonly cvBullets = new InMemoryRecords<CvBulletRecord>();
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
    const profile = new StagedRecords(this.store.profile);
    const experienceItems = new StagedRecords(this.store.experienceItems);
    const projects = new StagedRecords(this.store.projects);
    const posts = new StagedRecords(this.store.posts);
    const skills = new StagedRecords(this.store.skills);
    const cvBullets = new StagedRecords(this.store.cvBullets);
    const knowledgeEntries = new StagedRecords(this.store.knowledgeEntries);
    const result = await work({
      profile: new InMemoryProfileRepository(profile),
      experienceItems: new InMemoryExperienceItemRepository(experienceItems),
      projects: new InMemoryProjectRepository(projects),
      posts: new InMemoryPostRepository(posts),
      skills: new InMemorySkillRepository(skills),
      // The parents through this run's staged views: a parent saved earlier in the run is found.
      cvBullets: new InMemoryCvBulletRepository(cvBullets, { experienceItems, projects }),
      knowledgeEntries: new InMemoryKnowledgeEntryRepository(knowledgeEntries),
    });
    const tables = [profile, experienceItems, projects, posts, skills, cvBullets, knowledgeEntries];
    for (const table of tables) table.check();
    for (const table of tables) table.commit();
    return result;
  }
}
