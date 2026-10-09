import { ConcurrentModification } from "../domain/content.errors.js";

/** What every in-memory record holds: its root row with the id and the stored version. */
export interface VersionedRecord {
  readonly base: { readonly id: string; readonly version: number };
}

/**
 * The fakes' table of one aggregate type: its rows as copies, read and written by id with the same
 * compare-and-set rule as the Drizzle adapters (D5). The in-memory repositories run on either the
 * committed records or a unit of work's staged view of them.
 */
export abstract class RecordStore<R extends VersionedRecord> {
  /**
   * A copy of the record, so a change to it changes nothing stored.
   * @param id the item's id.
   * @returns the copy, or undefined.
   */
  abstract read(id: string): R | undefined;

  /**
   * Stores a copy of the record when the stored one is still at `expectedVersion`.
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   * @throws {ConcurrentModification} when the stored version differs, or a create finds the id.
   */
  abstract write(expectedVersion: number, record: R): void;
}

/**
 * The compare-and-set rule both adapters share: a create needs no stored record, an update needs
 * the stored record at the expected version.
 * @param id the item's id.
 * @param stored the record stored now, or undefined.
 * @param expectedVersion the version the caller loaded, 0 for a new item.
 * @throws {ConcurrentModification} when the rule fails.
 */
function assertVersion(id: string, stored: VersionedRecord | undefined, expectedVersion: number) {
  const matches =
    expectedVersion === 0 ? stored === undefined : stored?.base.version === expectedVersion;
  if (!matches) throw new ConcurrentModification(id, expectedVersion);
}

/** The committed records: what a read outside any unit of work sees. */
export class InMemoryRecords<R extends VersionedRecord> extends RecordStore<R> {
  private readonly rows = new Map<string, R>();

  /**
   * @param id the item's id.
   * @returns a copy of the committed record, or undefined.
   */
  read(id: string): R | undefined {
    const row = this.rows.get(id);
    return row === undefined ? undefined : structuredClone(row);
  }

  /**
   * Writes straight to the committed records (a repository used outside a unit of work).
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   */
  write(expectedVersion: number, record: R): void {
    assertVersion(record.base.id, this.rows.get(record.base.id), expectedVersion);
    this.rows.set(record.base.id, structuredClone(record));
  }

  /**
   * The committed version of a record, for a staged view's commit check.
   * @param id the item's id.
   * @returns the version, or undefined when no record has this id.
   */
  versionOf(id: string): number | undefined {
    return this.rows.get(id)?.base.version;
  }

  /**
   * Replaces records in one synchronous step: the fake unit of work's commit.
   * @param records the staged records.
   */
  apply(records: Iterable<R>): void {
    for (const record of records) this.rows.set(record.base.id, structuredClone(record));
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
   * @param id the item's id.
   * @returns a copy of the staged record, else of the committed one, or undefined.
   */
  read(id: string): R | undefined {
    const staged = this.staged.get(id);
    return staged ? structuredClone(staged.record) : this.committed.read(id);
  }

  /**
   * Stages a copy; nothing reaches the committed records before the commit.
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   * @param record the record at its next version.
   */
  write(expectedVersion: number, record: R): void {
    const id = record.base.id;
    assertVersion(id, this.read(id), expectedVersion);
    const basedOn = this.staged.has(id)
      ? this.staged.get(id)?.basedOn
      : this.committed.versionOf(id);
    this.staged.set(id, { record: structuredClone(record), basedOn });
  }

  /**
   * Checks that no staged item changed in the committed records since it was staged.
   * @throws {ConcurrentModification} for the first item that did.
   */
  check(): void {
    for (const [id, { basedOn }] of this.staged) {
      if (this.committed.versionOf(id) !== basedOn)
        throw new ConcurrentModification(id, basedOn ?? 0);
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
