import { SkillRepository } from "../application/skill.repository.js";
import type { Skill } from "../domain/skill.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";
import { type SkillBaseRow, skillFromRows, skillToRows } from "./skill-rows.js";

/** What the fake stores per skill: the rows of its three tables. */
export type SkillRecord = LocalizedRecord<SkillBaseRow>;

/**
 * The fake adapter of `SkillRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper. Passes the same contract suite as
 * `DrizzleSkillRepository`.
 */
export class InMemorySkillRepository extends SkillRepository {
  /** @param records the committed records, or a unit of work's staged view of them. */
  constructor(private readonly records: RecordStore<SkillRecord> = new InMemoryRecords()) {
    super();
  }

  /**
   * Rebuilds the stored skill from the revisions its pointers name.
   * @param id the skill's id.
   * @returns the skill, or undefined.
   */
  async get(id: string): Promise<Skill | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    return skillFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the skill's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param skill the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new skill.
   */
  async save(skill: Skill, expectedVersion: number): Promise<void> {
    const rows = skillToRows(skill, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, skill.id, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
