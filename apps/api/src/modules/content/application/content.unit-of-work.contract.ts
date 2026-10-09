import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { Project } from "../domain/project.js";
import { newEntry, newProject, saveProjectRevision } from "./content.contract-fixtures.js";
import type { ContentUnitOfWork } from "./content.unit-of-work.js";
import type { KnowledgeEntryRepository } from "./knowledge-entry.repository.js";
import type { ProjectRepository } from "./project.repository.js";

/** What the unit of work contract needs for each test: the unit of work and readers outside it. */
export interface ContentUnitOfWorkFixture {
  /** The unit of work under test. */
  readonly unitOfWork: ContentUnitOfWork;
  /** Repositories outside any transaction, over the same storage: they see only committed data. */
  readonly projects: ProjectRepository;
  readonly knowledgeEntries: KnowledgeEntryRepository;
}

/**
 * The contract every `ContentUnitOfWork` adapter passes (ADR-009, WP-10 D6, D5): committed work is
 * visible afterwards; work that throws leaves nothing and its error reaches the caller unchanged; a
 * reader outside sees nothing before the commit; and a version conflict in one save rolls back the
 * revisions an earlier save of the same run inserted (Trace 2b). The in-memory fake runs it in
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
