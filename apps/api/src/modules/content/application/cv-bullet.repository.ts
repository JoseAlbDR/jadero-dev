import type { CvBullet } from "../domain/cv-bullet.js";

/**
 * The port of CV bullet storage, an abstract class so it is also the DI token (ADR-003). Adapters in
 * infrastructure/ implement it and pass `cvBulletRepositoryContract`. Its parent is written
 * once, when the bullet is created, and never again.
 */
export abstract class CvBulletRepository {
  /**
   * Loads one CV bullet with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @param id the CV bullet's human id (`backend-10`).
   * @returns the CV bullet at its stored version, or undefined when no CV bullet has this id.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract get(id: string): Promise<CvBullet | undefined>;

  /**
   * Stores the CV bullet when it is still at `expectedVersion` (D5, compare-and-set): its layout,
   * every revision saved since it was loaded, and its per-locale pointers; the stored version
   * becomes `expectedVersion + 1`. `expectedVersion` 0 creates it. Atomic only inside the unit of
   * work, which every write uses.
   * A new bullet's parent (experience item or project) must already be stored: in the same run,
   * save the parent before the bullet, because the parent's foreign key is checked at once. An
   * update never writes the parent, so a stored bullet keeps the one it was created with.
   * @param bullet the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for a new CV bullet.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   * @throws {Error} the store's own error when a new bullet's parent is not stored (a foreign key
   * violation in Postgres): a use case bug, never a caller's mistake.
   */
  abstract save(bullet: CvBullet, expectedVersion: number): Promise<void>;
}
