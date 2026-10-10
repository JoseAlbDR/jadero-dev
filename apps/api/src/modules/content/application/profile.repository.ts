import type { Profile } from "../domain/profile.js";

/**
 * The port of profile storage, an abstract class so it is also the DI token (ADR-003). The profile
 * is a singleton: at most one is stored, so it is found, not looked up by id. Adapters in
 * infrastructure/ implement it and pass `profileRepositoryContract`.
 */
export abstract class ProfileRepository {
  /**
   * Loads the profile with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @returns the profile at its stored version, or undefined when none was created yet.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract find(): Promise<Profile | undefined>;

  /**
   * Stores the profile when it is still at `expectedVersion` (D5, compare-and-set): every revision
   * saved since it was loaded and its per-locale pointers; the stored version becomes
   * `expectedVersion + 1`. `expectedVersion` 0 creates it, and fails when any profile exists, even
   * one with another id (two first saves racing: one wins, the other is a conflict). Atomic only
   * inside the unit of work, which every write uses.
   * @param profile the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for the first profile.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds a profile.
   * @throws {StoredStateInvalid} when the profile carries an archive mark, which it cannot store.
   */
  abstract save(profile: Profile, expectedVersion: number): Promise<void>;
}
