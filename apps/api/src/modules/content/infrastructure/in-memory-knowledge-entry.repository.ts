import { KnowledgeEntryRepository } from "../application/knowledge-entry.repository.js";
import type { KnowledgeEntry } from "../domain/knowledge-entry.js";
import { appendRows, InMemoryRecords, type RecordStore } from "./in-memory-records.js";
import {
  entryRevisionsToLoad,
  type KnowledgeEntryBaseRow,
  type KnowledgeEntryRevisionRow,
  knowledgeEntryFromRows,
  knowledgeEntryToRows,
  type ProvenanceRow,
} from "./knowledge-entry-rows.js";

/** What the fake stores per entry: the rows of its three tables. */
export interface KnowledgeEntryRecord {
  readonly base: KnowledgeEntryBaseRow;
  /** Every revision ever saved, append-only, like the table. */
  readonly revisions: readonly KnowledgeEntryRevisionRow[];
  readonly provenance: readonly ProvenanceRow[];
}

/**
 * The fake adapter of `KnowledgeEntryRepository` (ADR-009), storing the same rows as the Drizzle
 * adapter through the same mapper. Passes the same contract suite as
 * `DrizzleKnowledgeEntryRepository`.
 */
export class InMemoryKnowledgeEntryRepository extends KnowledgeEntryRepository {
  /** @param records the committed records, or a unit of work's staged view of them. */
  constructor(private readonly records: RecordStore<KnowledgeEntryRecord> = new InMemoryRecords()) {
    super();
  }

  /**
   * Rebuilds the stored entry from its latest and approved revisions and their provenance.
   * @param id the entry's human id.
   * @returns the entry, or undefined.
   */
  async get(id: string): Promise<KnowledgeEntry | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    const provenance = new Map(record.provenance.map((row) => [row.revisionId, row]));
    return knowledgeEntryFromRows(
      record.base,
      entryRevisionsToLoad(record.revisions, record.base.approvedRevisionId).map((revision) => ({
        revision,
        provenance: provenance.get(revision.id) ?? null,
      })),
    );
  }

  /**
   * Stores the entry's rows when it is still at `expectedVersion`, appending its new revisions and
   * their provenance.
   * @param entry the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new entry.
   */
  async save(entry: KnowledgeEntry, expectedVersion: number): Promise<void> {
    const rows = knowledgeEntryToRows(entry, expectedVersion + 1);
    const stored = expectedVersion === 0 ? undefined : this.records.read(entry.id);
    this.records.write(expectedVersion, {
      base: rows.base,
      revisions: appendRows(stored?.revisions ?? [], rows.revisions),
      provenance: [...(stored?.provenance ?? []), ...rows.provenance],
    });
  }
}
