import type { Project } from "../domain/project.js";

/**
 * The port of project storage, an abstract class so it is also the DI token (ADR-003). Adapters in
 * infrastructure/ implement it and pass `projectRepositoryContract`.
 */
export abstract class ProjectRepository {
  /**
   * Loads one project with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @param id the project's id.
   * @returns the project at its stored version, or undefined when no project has this id.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract get(id: string): Promise<Project | undefined>;

  /**
   * Stores the project when it is still at `expectedVersion` (D5, compare-and-set): its layout,
   * every revision saved since it was loaded, and its per-locale pointers; the stored version
   * becomes `expectedVersion + 1`. `expectedVersion` 0 creates it. Atomic only inside the unit of
   * work, which every write uses.
   * @param project the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for a new project.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract save(project: Project, expectedVersion: number): Promise<void>;
}
