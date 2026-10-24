import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import { newNow, saveNowRevision } from "./content.contract-fixtures.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { NowRepository } from "./now.repository.js";

/**
 * The contract every `NowRepository` adapter passes (ADR-009, D5, WP-39 D2): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized contract
 * (no archive: the Now page has none), plus the singleton: a second Now page is a conflict.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository over storage that holds no Now page, for each test.
 */
export function nowRepositoryContract(
  name: string,
  make: () => NowRepository | Promise<NowRepository>,
): void {
  localizedRepositoryContract(name, {
    port: "NowRepository",
    make,
    create: () => newNow(),
    saveRevision: saveNowRevision,
    load: (repository) => repository.find(),
    loadUnknown: (repository) => repository.find(),
    save: (repository, now, expectedVersion) => repository.save(now, expectedVersion),
  });

  describe(`NowRepository contract: ${name}`, () => {
    it("refuses a second Now page with another id, and keeps the first", async () => {
      const repository = await make();
      const first = newNow();
      saveNowRevision(first, "es");
      await repository.save(first, 0);
      const second = newNow();
      saveNowRevision(second, "es");
      await expect(repository.save(second, 0)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.find())?.id).toBe(first.id);
    });

    it("refuses an update that names another Now page's id at the stored version", async () => {
      const repository = await make();
      const first = newNow();
      saveNowRevision(first, "es");
      await repository.save(first, 0);
      const other = newNow();
      saveNowRevision(other, "es");
      await expect(repository.save(other, 1)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.find())?.snapshot()).toEqual({ ...first.snapshot(), version: 1 });
    });
  });
}
