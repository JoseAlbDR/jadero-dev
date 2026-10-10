import type { KnowledgeEntry } from "../domain/knowledge-entry.js";

/**
 * The port of knowledge entry storage, an abstract class so it is also the DI token (ADR-003). It
 * is the owner's side: it reads and writes each revision's private provenance (D-67), which no
 * public query ever selects. Adapters in infrastructure/ pass `knowledgeEntryRepositoryContract`.
 */
export abstract class KnowledgeEntryRepository {
  /**
   * Loads one entry with its latest revision and, when older, its approved one, each with its
   * provenance; never the whole history (D1).
   * @param id the entry's human id (`kb-...`).
   * @returns the entry at its stored version, or undefined when no entry has this id.
   * @throws {StoredStateInvalid} when a stored document, checklist or state cannot be read back.
   */
  abstract get(id: string): Promise<KnowledgeEntry | undefined>;

  /**
   * Stores the entry when it is still at `expectedVersion` (D5, compare-and-set): every revision
   * saved since it was loaded with its provenance, and its approval state; the stored version
   * becomes `expectedVersion + 1`. `expectedVersion` 0 creates it. Atomic only inside the unit of
   * work, which every write uses.
   * @param entry the aggregate after the use case changed it; discard it afterwards.
   * @param expectedVersion the version the caller loaded, 0 for a new entry.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract save(entry: KnowledgeEntry, expectedVersion: number): Promise<void>;
}
