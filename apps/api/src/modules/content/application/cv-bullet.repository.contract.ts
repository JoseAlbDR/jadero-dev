import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CvBullet, type CvBulletParent } from "../domain/cv-bullet.js";
import {
  newCvBullet,
  newExperienceItem,
  newProject,
  saveCvBulletRevision,
} from "./content.contract-fixtures.js";
import type { CvBulletRepository } from "./cv-bullet.repository.js";
import type { ExperienceItemRepository } from "./experience-item.repository.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { ProjectRepository } from "./project.repository.js";

/** The bullet repository and its parents' repositories, over the same storage. */
export interface CvBulletContractFixture {
  readonly cvBullets: CvBulletRepository;
  readonly experienceItems: ExperienceItemRepository;
  readonly projects: ProjectRepository;
}

/**
 * Stores a new experience item, so a bullet can name it.
 * @param fixture the repositories.
 * @returns the parent the bullet names.
 */
async function storedExperienceItem(fixture: CvBulletContractFixture): Promise<CvBulletParent> {
  const item = newExperienceItem();
  await fixture.experienceItems.save(item, 0);
  return { kind: "experience-item", experienceItemId: item.id };
}

/**
 * Stores a new project, so a bullet can name it.
 * @param fixture the repositories.
 * @returns the parent the bullet names.
 */
async function storedProject(fixture: CvBulletContractFixture): Promise<CvBulletParent> {
  const project = newProject();
  await fixture.projects.save(project, 0);
  return { kind: "project", projectId: project.id };
}

/**
 * The contract every `CvBulletRepository` adapter passes (ADR-009, ADR-031, D1, D5, Q1 B): the
 * in-memory fake in `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared
 * localized contract, plus the parent: stored and read back for both kinds, refused when it is not
 * stored, and never changed by a later save.
 * @param name the adapter's name, shown in the test report.
 * @param make builds the bullet repository and its parents' repositories for each test.
 */
export function cvBulletRepositoryContract(
  name: string,
  make: () => CvBulletContractFixture | Promise<CvBulletContractFixture>,
): void {
  localizedRepositoryContract(name, {
    port: "CvBulletRepository",
    make,
    create: async (fixture) => newCvBullet(await storedExperienceItem(fixture)),
    saveRevision: saveCvBulletRevision,
    load: (fixture, bullet) => fixture.cvBullets.get(bullet.id),
    loadUnknown: (fixture) => fixture.cvBullets.get("placeholder-unknown"),
    save: (fixture, bullet, expectedVersion) => fixture.cvBullets.save(bullet, expectedVersion),
    archive: (bullet, archivedAt) => bullet.archive(archivedAt),
  });

  describe(`CvBulletRepository contract: ${name}`, () => {
    it("stores and reads back a project as the parent", async () => {
      const fixture = await make();
      const bullet = newCvBullet(await storedProject(fixture));
      saveCvBulletRevision(bullet, "es");
      await fixture.cvBullets.save(bullet, 0);
      const reloaded = await fixture.cvBullets.get(bullet.id);
      expect(reloaded?.parent).toEqual(bullet.parent);
      expect(reloaded?.snapshot()).toEqual({ ...bullet.snapshot(), version: 1 });
    });

    it("refuses a new bullet whose parent is not stored, and writes nothing", async () => {
      const fixture = await make();
      const orphan = newCvBullet({ kind: "experience-item", experienceItemId: randomUUID() });
      saveCvBulletRevision(orphan, "es");
      await expect(fixture.cvBullets.save(orphan, 0)).rejects.toThrow();
      expect(await fixture.cvBullets.get(orphan.id)).toBeUndefined();
    });

    it("keeps the parent it was created with, whatever a later save carries", async () => {
      const fixture = await make();
      const original = await storedExperienceItem(fixture);
      const bullet = newCvBullet(original);
      saveCvBulletRevision(bullet, "es");
      await fixture.cvBullets.save(bullet, 0);
      // A use case bug: the same bullet rebuilt with another parent and a new importance.
      const loaded = (await fixture.cvBullets.get(bullet.id)) as CvBullet;
      const moved = CvBullet.reconstitute({
        ...loaded.snapshot(),
        parent: await storedProject(fixture),
        importance: 1,
      });
      await fixture.cvBullets.save(moved, 1);
      const reloaded = await fixture.cvBullets.get(bullet.id);
      expect(reloaded?.parent).toEqual(original);
      expect(reloaded?.importance).toBe(1);
      expect(reloaded?.version).toBe(2);
    });
  });
}
