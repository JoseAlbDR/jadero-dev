import type { Now } from "../domain/now.js";

/**
 * The port of Now storage (WP-39 D2), an abstract class so it is also the DI token (ADR-003). Like
 * the profile, the Now page is a singleton: at most one is stored, so it is found, not looked up by
 * id. Adapters in infrastructure/ implement it and pass `nowRepositoryContract`.
 */
export abstract class NowRepository {
  /**
   * Loads the Now page with its per-locale pointers and the revisions they name (the latest and the
   * published one of each locale), never the whole history (D1).
   * @returns the Now page at its stored version, or undefined when none was created yet.
   * @throws {StoredStateInvalid} when a stored document or pointer cannot be read back.
   */
  abstract find(): Promise<Now | undefined>;

  /**
   * Stores the Now page when it is still at `expectedVersion` (D5, compare-and-set): every revision
   * saved since it was loaded and its per-locale pointers; the stored version becomes
   * `expectedVersion + 1`. `expectedVersion` 0 creates it, and fails when any Now page exists, even
   * one with another id. Atomic only inside the unit of work, which every write uses.
   * @param now the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for the first Now page.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds one.
   * @throws {StoredStateInvalid} when the Now page carries an archive mark, which it cannot store.
   */
  abstract save(now: Now, expectedVersion: number): Promise<void>;
}
