import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { Project } from "../domain/project.js";
import { at, newProject, saveProjectRevision } from "./content.contract-fixtures.js";
import type { ProjectRepository } from "./project.repository.js";

/**
 * The contract every `ProjectRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. It checks what goes through
 * the port: a reload equals what was saved, the version check refuses a stale save and writes
 * nothing, every new revision is stored, and the published pointer is the one the domain chose.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository for each test.
 */
export function projectRepositoryContract(
  name: string,
  make: () => ProjectRepository | Promise<ProjectRepository>,
): void {
  /** Saves a new project with es and en at revision 1; returns it reloaded at version 1. */
  async function stored(repository: ProjectRepository): Promise<Project> {
    const project = newProject();
    saveProjectRevision(project, "es");
    saveProjectRevision(project, "en");
    await repository.save(project, 0);
    return (await repository.get(project.id)) as Project;
  }

  describe(`ProjectRepository contract: ${name}`, () => {
    it("returns undefined for an unknown id", async () => {
      const repository = await make();
      expect(await repository.get(randomUUID())).toBeUndefined();
    });

    it("reloads a new project equal to its snapshot, at version 1", async () => {
      const repository = await make();
      const project = newProject();
      saveProjectRevision(project, "es");
      saveProjectRevision(project, "en", 1);
      await repository.save(project, 0);
      const reloaded = await repository.get(project.id);
      expect(reloaded?.snapshot()).toEqual({ ...project.snapshot(), version: 1 });
      expect(reloaded?.translations.stateOf("es")).toBe("draft");
      expect(reloaded?.translations.stateOf("de")).toBe("missing");
    });

    it("refuses a stale version with ConcurrentModification and writes nothing", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      const before = loaded.snapshot();
      saveProjectRevision(loaded, "es", 5, "Changed");
      await expect(repository.save(loaded, 7)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.get(loaded.id))?.snapshot()).toEqual(before);
    });

    it("refuses a create of an id that exists, and an update of one that does not", async () => {
      const repository = await make();
      const existing = await stored(repository);
      await expect(repository.save(existing, 0)).rejects.toBeInstanceOf(ConcurrentModification);
      await expect(repository.save(newProject(), 1)).rejects.toBeInstanceOf(ConcurrentModification);
    });

    it("stores both revisions saved in one locale before a save", async () => {
      const repository = await make();
      const project = newProject();
      const first = saveProjectRevision(project, "es", 0, "First");
      const second = saveProjectRevision(project, "es", 1, "Second");
      saveProjectRevision(project, "en");
      // Publish the older one: a reload can only show it if its row was inserted too.
      const older = { locale: "es" as const, revision: olderRevision(project, first) };
      project.publish([older, "en"], at(2));
      await repository.save(project, 0);
      const reloaded = await repository.get(project.id);
      expect(reloaded?.translations.published("es")?.id).toBe(first);
      expect(reloaded?.translations.published("es")?.number).toBe(1);
      expect(reloaded?.translations.latest("es")?.id).toBe(second);
      expect(reloaded?.translations.latest("es")?.number).toBe(2);
      expect(reloaded?.translations.stateOf("es")).toBe("changed");
    });

    it("stores the published pointer the domain returned", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      const result = loaded.publish(["es", "en"], at(3));
      await repository.save(loaded, 1);
      const reloaded = await repository.get(loaded.id);
      expect(reloaded?.version).toBe(2);
      expect(result.published).toHaveLength(2);
      for (const { locale, revisionId } of result.published) {
        expect(reloaded?.translations.published(locale)?.id).toBe(revisionId);
        expect(reloaded?.translations.stateOf(locale)).toBe("published");
        expect(reloaded?.translations.publishedAt(locale)).toEqual(at(3));
        expect(reloaded?.translations.firstPublishedAt(locale)).toEqual(at(3));
      }
    });

    it("keeps the published revision live after a newer one is saved", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      loaded.publish(["es", "en"], at(3));
      await repository.save(loaded, 1);
      const again = (await repository.get(loaded.id)) as Project;
      const published = again.translations.published("es")?.id;
      const newer = saveProjectRevision(again, "es", 4, "Newer");
      await repository.save(again, 2);
      const reloaded = await repository.get(loaded.id);
      expect(reloaded?.translations.published("es")?.id).toBe(published);
      expect(reloaded?.translations.latest("es")?.id).toBe(newer);
      expect(reloaded?.translations.stateOf("es")).toBe("changed");
      expect(reloaded?.snapshot()).toEqual({ ...again.snapshot(), version: 3 });
    });

    it("stores the archive mark", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      loaded.archive(at(9));
      await repository.save(loaded, 1);
      expect((await repository.get(loaded.id))?.translations.archivedAt()).toEqual(at(9));
    });
  });
}

/** A revision the project holds, by id (the older one a rollback names). */
function olderRevision(project: Project, id: string) {
  const held = project.unsavedRevisions().find((revision) => revision.id === id);
  if (!held) throw new Error(`revision ${id} is not held`);
  return held;
}
