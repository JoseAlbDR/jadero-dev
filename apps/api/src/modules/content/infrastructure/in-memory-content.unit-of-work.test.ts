import { describe, expect, it } from "vitest";
import { newProject, saveProjectRevision } from "../application/content.contract-fixtures.js";
import { contentUnitOfWorkContract } from "../application/content.unit-of-work.contract.js";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { Project } from "../domain/project.js";
import {
  InMemoryContentStore,
  InMemoryContentUnitOfWork,
} from "./in-memory-content.unit-of-work.js";
import { InMemoryKnowledgeEntryRepository } from "./in-memory-knowledge-entry.repository.js";
import { InMemoryProjectRepository } from "./in-memory-project.repository.js";

/** A unit of work and readers over one fresh store. */
function fixture() {
  const store = new InMemoryContentStore();
  return {
    unitOfWork: new InMemoryContentUnitOfWork(store),
    projects: new InMemoryProjectRepository(store.projects),
    knowledgeEntries: new InMemoryKnowledgeEntryRepository(store.knowledgeEntries),
  };
}

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
contentUnitOfWorkContract("in-memory", fixture);

describe("InMemoryContentUnitOfWork", () => {
  it("refuses a commit when another run committed the same item meanwhile, like a row lock would", async () => {
    const { unitOfWork, projects } = fixture();
    const created = newProject();
    saveProjectRevision(created, "es");
    saveProjectRevision(created, "en");
    await unitOfWork.run((scope) => scope.projects.save(created, 0));

    let release: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = unitOfWork.run(async (scope) => {
      const loaded = (await scope.projects.get(created.id)) as Project;
      saveProjectRevision(loaded, "es", 1, "Slow");
      await scope.projects.save(loaded, 1);
      await paused;
    });
    await unitOfWork.run(async (scope) => {
      const loaded = (await scope.projects.get(created.id)) as Project;
      saveProjectRevision(loaded, "es", 2, "Fast");
      await scope.projects.save(loaded, 1);
    });
    release();

    await expect(slow).rejects.toBeInstanceOf(ConcurrentModification);
    expect((await projects.get(created.id))?.translations.latest("es")?.document.title).toBe(
      "Fast (es)",
    );
  });
});
