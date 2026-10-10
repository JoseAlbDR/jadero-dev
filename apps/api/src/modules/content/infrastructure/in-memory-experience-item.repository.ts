import { ExperienceItemRepository } from "../application/experience-item.repository.js";
import type { ExperienceItem } from "../domain/experience-item.js";
import {
  type ExperienceItemBaseRow,
  experienceItemFromRows,
  experienceItemToRows,
} from "./experience-item-rows.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";

/** What the fake stores per experience item: the rows of its three tables. */
export type ExperienceItemRecord = LocalizedRecord<ExperienceItemBaseRow>;

/**
 * The fake adapter of `ExperienceItemRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper. Passes the same contract suite as
 * `DrizzleExperienceItemRepository`.
 */
export class InMemoryExperienceItemRepository extends ExperienceItemRepository {
  /** @param records the committed records, or a unit of work's staged view of them. */
  constructor(private readonly records: RecordStore<ExperienceItemRecord> = new InMemoryRecords()) {
    super();
  }

  /**
   * Rebuilds the stored experience item from the revisions its pointers name.
   * @param id the experience item's id.
   * @returns the experience item, or undefined.
   */
  async get(id: string): Promise<ExperienceItem | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    return experienceItemFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the experience item's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param item the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new experience item.
   */
  async save(item: ExperienceItem, expectedVersion: number): Promise<void> {
    const rows = experienceItemToRows(item, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, item.id, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
