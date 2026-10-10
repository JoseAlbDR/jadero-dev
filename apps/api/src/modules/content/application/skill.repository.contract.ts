import { randomUUID } from "node:crypto";
import { newSkill, saveSkillRevision } from "./content.contract-fixtures.js";
import { localizedRepositoryContract } from "./localized.repository.contract.js";
import type { SkillRepository } from "./skill.repository.js";

/**
 * The contract every `SkillRepository` adapter passes (ADR-009, D5, Q1 B): the in-memory fake in
 * `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. The shared localized contract,
 * whose snapshot comparisons cover the layout field (`sortOrder`) on the root row.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository for each test.
 */
export function skillRepositoryContract(
  name: string,
  make: () => SkillRepository | Promise<SkillRepository>,
): void {
  localizedRepositoryContract(name, {
    port: "SkillRepository",
    make,
    create: () => newSkill(),
    saveRevision: saveSkillRevision,
    load: (repository, skill) => repository.get(skill.id),
    loadUnknown: (repository) => repository.get(randomUUID()),
    save: (repository, skill, expectedVersion) => repository.save(skill, expectedVersion),
    archive: (skill, archivedAt) => skill.archive(archivedAt),
  });
}
