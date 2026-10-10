import { randomUUID } from "node:crypto";
import { newExperienceItem, saveExperienceItemRevision } from "./content.contract-fixtures.js";
import type { ExperienceItemRepository } from "./experience-item.repository.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";

/**
 * The contract every `ExperienceItemRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory
 * fake in `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized
 * contract, whose snapshot comparisons cover the layout field (`sortOrder`) on the root row.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository for each test.
 */
export function experienceItemRepositoryContract(
  name: string,
  make: () => ExperienceItemRepository | Promise<ExperienceItemRepository>,
): void {
  localizedRepositoryContract(name, {
    port: "ExperienceItemRepository",
    make,
    create: () => newExperienceItem(),
    saveRevision: saveExperienceItemRevision,
    load: (repository, item) => repository.get(item.id),
    loadUnknown: (repository) => repository.get(randomUUID()),
    save: (repository, item, expectedVersion) => repository.save(item, expectedVersion),
    archive: (item, archivedAt) => item.archive(archivedAt),
  });
}
