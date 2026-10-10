import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import { newProfile, saveProfileRevision } from "./content.contract-fixtures.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { ProfileRepository } from "./profile.repository.js";

/**
 * The contract every `ProfileRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized contract
 * (no archive: the profile has none), plus the singleton: a second profile is a conflict.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository over storage that holds no profile, for each test.
 */
export function profileRepositoryContract(
  name: string,
  make: () => ProfileRepository | Promise<ProfileRepository>,
): void {
  localizedRepositoryContract(name, {
    port: "ProfileRepository",
    make,
    create: () => newProfile(),
    saveRevision: saveProfileRevision,
    load: (repository) => repository.find(),
    loadUnknown: (repository) => repository.find(),
    save: (repository, profile, expectedVersion) => repository.save(profile, expectedVersion),
  });

  describe(`ProfileRepository contract: ${name}`, () => {
    it("refuses a second profile with another id, and keeps the first", async () => {
      const repository = await make();
      const first = newProfile();
      saveProfileRevision(first, "es");
      await repository.save(first, 0);
      const second = newProfile();
      saveProfileRevision(second, "es");
      await expect(repository.save(second, 0)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.find())?.id).toBe(first.id);
    });

    it("refuses an update that names another profile's id at the stored version", async () => {
      const repository = await make();
      const first = newProfile();
      saveProfileRevision(first, "es");
      await repository.save(first, 0);
      const other = newProfile();
      saveProfileRevision(other, "es");
      await expect(repository.save(other, 1)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.find())?.snapshot()).toEqual({ ...first.snapshot(), version: 1 });
    });
  });
}
