import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { Profile } from "../domain/profile.js";
import type { Project } from "../domain/project.js";
import {
  newCvBullet,
  newEntry,
  newExperienceItem,
  newPost,
  newProfile,
  newProject,
  newSkill,
  saveCvBulletRevision,
  saveExperienceItemRevision,
  savePostRevision,
  saveProfileRevision,
  saveProjectRevision,
  saveSkillRevision,
} from "./content.contract-fixtures.js";
import type { ContentUnitOfWork } from "./content.unit-of-work.js";
import type { CvBulletRepository } from "./cv-bullet.repository.js";
import type { ExperienceItemRepository } from "./experience-item.repository.js";
import type { KnowledgeEntryRepository } from "./knowledge-entry.repository.js";
import type { PostRepository } from "./post.repository.js";
import type { ProfileRepository } from "./profile.repository.js";
import type { ProjectRepository } from "./project.repository.js";
import type { SkillRepository } from "./skill.repository.js";

/**
 * What the unit of work contract needs for each test: the unit of work and readers outside it, over
 * storage that holds no profile (the singleton).
 */
export interface ContentUnitOfWorkFixture {
  /** The unit of work under test. */
  readonly unitOfWork: ContentUnitOfWork;
  /** Repositories outside any transaction, over the same storage: they see only committed data. */
  readonly profile: ProfileRepository;
  readonly experienceItems: ExperienceItemRepository;
  readonly projects: ProjectRepository;
  readonly posts: PostRepository;
  readonly skills: SkillRepository;
  readonly cvBullets: CvBulletRepository;
  readonly knowledgeEntries: KnowledgeEntryRepository;
}

/**
 * The contract every `ContentUnitOfWork` adapter passes (ADR-009, WP-10 D6, D5): committed work is
 * visible afterwards; work that throws leaves nothing and its error reaches the caller unchanged; a
 * reader outside sees nothing before the commit; and a version conflict in one save rolls back the
 * revisions an earlier save of the same run inserted (Trace 2b); every scope repository is bound to
 * the run; a bullet finds a parent saved earlier in the run; and of two runs creating a profile,
 * one wins and one is a conflict (the singleton). The in-memory fake runs it in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a unit of work and readers over the same storage for each test.
 */
export function contentUnitOfWorkContract(
  name: string,
  make: () => ContentUnitOfWorkFixture | Promise<ContentUnitOfWorkFixture>,
): void {
  /** A project with es and en at revision 1. */
  function project(): Project {
    const created = newProject();
    saveProjectRevision(created, "es");
    saveProjectRevision(created, "en");
    return created;
  }

  describe(`ContentUnitOfWork contract: ${name}`, () => {
    it("commits the work: every repository's write is visible afterwards", async () => {
      const { unitOfWork, projects, knowledgeEntries } = await make();
      const created = project();
      const entry = newEntry();
      const result = await unitOfWork.run(async (scope) => {
        await scope.projects.save(created, 0);
        await scope.knowledgeEntries.save(entry, 0);
        return "done";
      });
      expect(result).toBe("done");
      expect((await projects.get(created.id))?.version).toBe(1);
      expect((await knowledgeEntries.get(entry.id))?.version).toBe(1);
    });

    it("commits every type's write: each scope repository is bound to the run", async () => {
      const fixture = await make();
      const profile = newProfile();
      saveProfileRevision(profile, "es");
      const item = newExperienceItem();
      saveExperienceItemRevision(item, "es");
      const post = newPost();
      savePostRevision(post, "es");
      const skill = newSkill();
      saveSkillRevision(skill, "es");
      const bullet = newCvBullet({ kind: "experience-item", experienceItemId: item.id });
      saveCvBulletRevision(bullet, "es");
      await fixture.unitOfWork.run(async (scope) => {
        await scope.profile.save(profile, 0);
        // The parent first: its foreign key is checked when the bullet's row is inserted.
        await scope.experienceItems.save(item, 0);
        await scope.posts.save(post, 0);
        await scope.skills.save(skill, 0);
        await scope.cvBullets.save(bullet, 0);
      });
      expect((await fixture.profile.find())?.id).toBe(profile.id);
      expect((await fixture.experienceItems.get(item.id))?.version).toBe(1);
      expect((await fixture.posts.get(post.id))?.version).toBe(1);
      expect((await fixture.skills.get(skill.id))?.version).toBe(1);
      expect((await fixture.cvBullets.get(bullet.id))?.parent).toEqual(bullet.parent);
    });

    it("refuses a run that saves a bullet before its parent, and keeps neither", async () => {
      const { unitOfWork, experienceItems, cvBullets } = await make();
      const item = newExperienceItem();
      const bullet = newCvBullet({ kind: "experience-item", experienceItemId: item.id });
      saveCvBulletRevision(bullet, "es");
      await expect(
        unitOfWork.run(async (scope) => {
          await scope.cvBullets.save(bullet, 0);
          await scope.experienceItems.save(item, 0);
        }),
      ).rejects.toThrow();
      expect(await cvBullets.get(bullet.id)).toBeUndefined();
      expect(await experienceItems.get(item.id)).toBeUndefined();
    });

    it("lets one of two concurrent first profiles win; the other is a conflict", async () => {
      const { unitOfWork, profile } = await make();
      const first = newProfile();
      saveProfileRevision(first, "es");
      const second = newProfile();
      saveProfileRevision(second, "es");
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markSaved: () => void = () => {};
      const saved = new Promise<void>((resolve) => {
        markSaved = resolve;
      });
      // The first run holds its uncommitted profile until the second has started: in Postgres the
      // second insert waits on the singleton index, then finds the committed row.
      const a = unitOfWork.run(async (scope) => {
        await scope.profile.save(first, 0);
        markSaved();
        await gate;
        return first.id;
      });
      await saved;
      const b = unitOfWork.run(async (scope) => {
        await scope.profile.save(second, 0);
        return second.id;
      });
      release();
      const results = await Promise.allSettled([a, b]);
      const won = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const lost = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toBeInstanceOf(ConcurrentModification);
      const stored = (await profile.find()) as Profile;
      expect(stored.id).toBe(won[0]);
      expect(stored.version).toBe(1);
    });

    it("lets the work read its own write before the commit", async () => {
      const { unitOfWork } = await make();
      const created = project();
      const seen = await unitOfWork.run(async (scope) => {
        await scope.projects.save(created, 0);
        return scope.projects.get(created.id);
      });
      expect(seen?.snapshot()).toEqual({ ...created.snapshot(), version: 1 });
    });

    it("discards every write when the work throws after a save, and rethrows the same error", async () => {
      const { unitOfWork, projects, knowledgeEntries } = await make();
      const created = project();
      const entry = newEntry();
      const failure = new Error("rule checked too late");
      await expect(
        unitOfWork.run(async (scope) => {
          await scope.projects.save(created, 0);
          await scope.knowledgeEntries.save(entry, 0);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await projects.get(created.id)).toBeUndefined();
      expect(await knowledgeEntries.get(entry.id)).toBeUndefined();
    });

    it("hides the work's writes from a reader outside it until the commit", async () => {
      const { unitOfWork, projects } = await make();
      const created = project();
      let seenOutside: Project | undefined;
      await unitOfWork.run(async (scope) => {
        await scope.projects.save(created, 0);
        seenOutside = await projects.get(created.id);
      });
      expect(seenOutside).toBeUndefined();
      expect(await projects.get(created.id)).toBeDefined();
    });

    it("rolls back an earlier save's revisions when a later save of the run conflicts", async () => {
      const { unitOfWork, projects } = await make();
      const created = project();
      await unitOfWork.run((scope) => scope.projects.save(created, 0));
      const original = (await projects.get(created.id))?.snapshot();
      // A second tab loaded the same version before this run.
      const stale = (await projects.get(created.id)) as Project;
      await expect(
        unitOfWork.run(async (scope) => {
          const fresh = (await scope.projects.get(created.id)) as Project;
          saveProjectRevision(fresh, "es", 1, "Inserted then rolled back");
          await scope.projects.save(fresh, 1);
          saveProjectRevision(stale, "es", 2, "Stale");
          await scope.projects.save(stale, 1);
        }),
      ).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await projects.get(created.id))?.snapshot()).toEqual(original);
    });
  });
}
