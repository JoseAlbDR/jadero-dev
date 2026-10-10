import type { ExperienceItem } from "../domain/experience-item.js";

/**
 * The port of experience item storage, an abstract class so it is also the DI token (ADR-003). Adapters in
 * infrastructure/ implement it and pass `experienceItemRepositoryContract`.
 */
export abstract class ExperienceItemRepository {
  /**
   * Loads one experience item with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @param id the experience item's id.
   * @returns the experience item at its stored version, or undefined when no experience item has this id.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract get(id: string): Promise<ExperienceItem | undefined>;

  /**
   * Stores the experience item when it is still at `expectedVersion` (D5, compare-and-set): its layout,
   * every revision saved since it was loaded, and its per-locale pointers; the stored version
   * becomes `expectedVersion + 1`. `expectedVersion` 0 creates it. Atomic only inside the unit of
   * work, which every write uses.
   * @param item the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for a new experience item.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract save(item: ExperienceItem, expectedVersion: number): Promise<void>;
}
