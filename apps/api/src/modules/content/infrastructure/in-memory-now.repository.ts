import { NowRepository } from "../application/now.repository.js";
import type { Now } from "../domain/now.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";
import { type NowBaseRow, nowFromRows, nowToRows } from "./now-rows.js";

/** What the fake stores for the Now page: the rows of its three tables. */
export type NowRecord = LocalizedRecord<NowBaseRow>;

/** The one key every Now record is kept under: the fake's `now_singleton` index. */
const NOW_KEY = "now";

/**
 * The fake's Now table: every record under one key, so a create finds any stored Now page, even one
 * with another id, and a staged create fails at commit when another run created one meanwhile.
 * @returns an empty table.
 */
export function nowRecords(): InMemoryRecords<NowRecord> {
  return new InMemoryRecords<NowRecord>(() => NOW_KEY);
}

/**
 * The fake adapter of `NowRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper, and refuses a second Now page as the singleton index
 * does. Passes the same contract suite as `DrizzleNowRepository`.
 */
export class InMemoryNowRepository extends NowRepository {
  /**
   * @param records the committed records from `nowRecords()`, or a unit of work's staged view of
   * them.
   */
  constructor(private readonly records: RecordStore<NowRecord> = nowRecords()) {
    super();
  }

  /**
   * Rebuilds the stored Now page from the revisions its pointers name.
   * @returns the Now page, or undefined when none was created.
   */
  async find(): Promise<Now | undefined> {
    const record = this.records.read(NOW_KEY);
    if (!record) return undefined;
    return nowFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the Now page's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param now the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for the first Now page.
   */
  async save(now: Now, expectedVersion: number): Promise<void> {
    const rows = nowToRows(now, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, NOW_KEY, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
