import { ConcurrentModification } from "../domain/content.errors.js";
import { pointedRevisionIds, type RevisionRow, type TranslationRow } from "./revision-rows.js";

/** What every in-memory record holds: its root row with the id and the stored version. */
export interface VersionedRecord {
  readonly base: { readonly id: string; readonly version: number };
}

/**
 * Where a record is kept: by default its id, like a primary key. The profile keeps every record
 * under one constant key, like its singleton index, so a second profile is a conflict.
 */
export type RecordKey<R extends VersionedRecord> = (record: R) => string;

/** The default key: the record's id. */
const byId = (record: VersionedRecord): string => record.base.id;

/**
 * The fakes' table of one aggregate type: its rows as copies, read and written by key with the same
 * compare-and-set rule as the Drizzle adapters (D5). The in-memory repositories run on either the
 * committed records or a unit of work's staged view of them.
 */
export abstract class RecordStore<R extends VersionedRecord> {
  /**
   * A copy of the record, so a change to it changes nothing stored.
   * @param key the record's key: the item's id, or the profile's constant key.
   * @returns the copy, or undefined.
   */
  abstract read(key: string): R | undefined;

  /**
   * Stores a copy of the record when the stored one is still at `expectedVersion`.
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract write(expectedVersion: number, record: R): void;
}

/**
 * The compare-and-set rule both adapters share: a create needs no stored record under its key, an
 * update needs the stored record to be this item (`WHERE id = $1`) at the expected version.
 * @param id the item's id.
 * @param stored the record stored now under the item's key, or undefined.
 * @param expectedVersion the version the caller loaded, 0 for a new item.
 * @throws {ConcurrentModification} when the rule fails.
 */
function assertVersion(id: string, stored: VersionedRecord | undefined, expectedVersion: number) {
  const matches =
    expectedVersion === 0
      ? stored === undefined
      : stored?.base.id === id && stored.base.version === expectedVersion;
  if (!matches) throw new ConcurrentModification(id, expectedVersion);
}

/** The committed records: what a read outside any unit of work sees. */
export class InMemoryRecords<R extends VersionedRecord> extends RecordStore<R> {
  private readonly rows = new Map<string, R>();

  /** @param keyOf where a record is kept; its id unless the type is a singleton. */
  constructor(readonly keyOf: RecordKey<R> = byId) {
    super();
  }

  /**
   * @param key the record's key.
   * @returns a copy of the committed record, or undefined.
   */
  read(key: string): R | undefined {
    const row = this.rows.get(key);
    return row === undefined ? undefined : structuredClone(row);
  }

  /**
   * Writes straight to the committed records (a repository used outside a unit of work).
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   */
  write(expectedVersion: number, record: R): void {
    const key = this.keyOf(record);
    assertVersion(record.base.id, this.rows.get(key), expectedVersion);
    this.rows.set(key, structuredClone(record));
  }

  /**
   * The committed version of a record, for a staged view's commit check.
   * @param key the record's key.
   * @returns the version, or undefined when no record has this key.
   */
  versionOf(key: string): number | undefined {
    return this.rows.get(key)?.base.version;
  }

  /**
   * Replaces records in one synchronous step: the fake unit of work's commit.
   * @param records the staged records.
   */
  apply(records: Iterable<R>): void {
    for (const record of records) this.rows.set(this.keyOf(record), structuredClone(record));
  }
}

/**
 * A unit of work's view of the committed records: writes are staged, reads see the staged record
 * first (read your own writes). Each staged record remembers the committed version it was based on,
 * so a commit after another unit of work changed the same item fails, as the row lock and the
 * version check make it fail in Postgres.
 */
export class StagedRecords<R extends VersionedRecord> extends RecordStore<R> {
  private readonly staged = new Map<string, { record: R; basedOn: number | undefined }>();

  constructor(private readonly committed: InMemoryRecords<R>) {
    super();
  }

  /**
   * @param key the record's key.
   * @returns a copy of the staged record, else of the committed one, or undefined.
   */
  read(key: string): R | undefined {
    const staged = this.staged.get(key);
    return staged ? structuredClone(staged.record) : this.committed.read(key);
  }

  /**
   * Stages a copy; nothing reaches the committed records before the commit.
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   */
  write(expectedVersion: number, record: R): void {
    const key = this.committed.keyOf(record);
    assertVersion(record.base.id, this.read(key), expectedVersion);
    const basedOn = this.staged.has(key)
      ? this.staged.get(key)?.basedOn
      : this.committed.versionOf(key);
    this.staged.set(key, { record: structuredClone(record), basedOn });
  }

  /**
   * Checks that no staged item changed in the committed records since it was staged (for the
   * profile, that no other run committed a profile: its singleton index).
   * @throws {ConcurrentModification} for the first item that did.
   */
  check(): void {
    for (const { record, basedOn } of this.staged.values()) {
      if (this.committed.versionOf(this.committed.keyOf(record)) !== basedOn)
        throw new ConcurrentModification(record.base.id, basedOn ?? 0);
    }
  }

  /** Applies every staged record to the committed ones; call `check` on every view first. */
  commit(): void {
    this.committed.apply([...this.staged.values()].map(({ record }) => record));
  }
}

/**
 * Appends new rows to stored ones, refusing an id already stored, as the revision table's primary
 * key does: saving the same aggregate twice inserts its revisions twice, and must fail here too.
 * @param stored the rows stored so far.
 * @param added the new rows.
 * @returns both, stored first.
 * @throws {Error} when a new row's id is already stored.
 */
export function appendRows<T extends { readonly id: string }>(
  stored: readonly T[],
  added: readonly T[],
): T[] {
  const ids = new Set(stored.map((row) => row.id));
  const duplicate = added.find((row) => ids.has(row.id));
  if (duplicate) throw new Error(`Row ${duplicate.id} is already stored.`);
  return [...stored, ...added];
}

/**
 * What the fakes store per localized item (Q1 B): the rows of its three tables, as the Drizzle
 * adapter writes them.
 */
export interface LocalizedRecord<
  B extends VersionedRecord["base"],
  T extends TranslationRow = TranslationRow,
> {
  readonly base: B;
  readonly translations: readonly T[];
  /** Every revision ever saved, append-only, like the table. */
  readonly revisions: readonly RevisionRow[];
}

/**
 * The revisions a localized repository loads from a record: only those its pointers name (D1), the
 * fakes' copy of `DrizzleLocalizedRows.load`.
 * @param record the stored record.
 * @returns the latest and the published revision of each locale.
 */
export function pointedRevisions(record: LocalizedRecord<VersionedRecord["base"]>): RevisionRow[] {
  const pointed = new Set(pointedRevisionIds(record.translations));
  return record.revisions.filter((revision) => pointed.has(revision.id));
}

/**
 * The revisions a localized save appends to: none for a create, the stored ones for an update.
 * @param records the store the save writes to.
 * @param key the record's key.
 * @param expectedVersion the version the caller loaded, 0 for a new item.
 * @returns the stored revision rows.
 */
export function storedRevisions(
  records: RecordStore<LocalizedRecord<VersionedRecord["base"]>>,
  key: string,
  expectedVersion: number,
): readonly RevisionRow[] {
  return expectedVersion === 0 ? [] : (records.read(key)?.revisions ?? []);
}
