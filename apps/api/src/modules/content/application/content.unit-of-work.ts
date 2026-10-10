import type { CvBulletRepository } from "./cv-bullet.repository.js";
import type { ExperienceItemRepository } from "./experience-item.repository.js";
import type { KnowledgeEntryRepository } from "./knowledge-entry.repository.js";
import type { PostRepository } from "./post.repository.js";
import type { ProfileRepository } from "./profile.repository.js";
import type { ProjectRepository } from "./project.repository.js";
import type { SkillRepository } from "./skill.repository.js";

/**
 * What a unit of work hands its work: one repository per content aggregate, all bound to one
 * transaction. WP-14 adds the outbox writer, so a publish and its event commit together.
 */
export interface ContentScope {
  /** The profile repository (a singleton), bound to the transaction. */
  readonly profile: ProfileRepository;
  /** The experience items repository, bound to the transaction. */
  readonly experienceItems: ExperienceItemRepository;
  /** The projects repository, bound to the transaction. */
  readonly projects: ProjectRepository;
  /** The posts repository, bound to the transaction. */
  readonly posts: PostRepository;
  /** The skills repository, bound to the transaction. */
  readonly skills: SkillRepository;
  /** The CV bullets repository, bound to the transaction; save a new bullet's parent first. */
  readonly cvBullets: CvBulletRepository;
  /** The knowledge entries repository, bound to the transaction. */
  readonly knowledgeEntries: KnowledgeEntryRepository;
}

/**
 * The port of the content module's transactions (unit of work, WP-10 D6), an abstract class so it
 * is also the DI token (ADR-003). Every write use case runs inside `run`; a version conflict thrown
 * by any save in it rolls back every other write of the same run (D5, Trace 2b).
 */
export abstract class ContentUnitOfWork {
  /**
   * Runs `work` as one transaction. Commits when `work` resolves; discards everything it wrote and
   * rethrows the same error when it throws. Use the scope's repositories, never constructor-injected
   * ones, for anything inside `work`.
   * @param work the use case's reads-for-writing and writes.
   * @returns what `work` returned, after the commit.
   */
  abstract run<T>(work: (scope: ContentScope) => Promise<T>): Promise<T>;
}
