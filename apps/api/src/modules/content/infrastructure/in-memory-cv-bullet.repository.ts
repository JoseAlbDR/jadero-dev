import { CvBulletRepository } from "../application/cv-bullet.repository.js";
import type { CvBullet, CvBulletParent } from "../domain/cv-bullet.js";
import { type CvBulletBaseRow, cvBulletFromRows, cvBulletToRows } from "./cv-bullet-rows.js";
import type { ExperienceItemRecord } from "./in-memory-experience-item.repository.js";
import type { ProjectRecord } from "./in-memory-project.repository.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";

/** What the fake stores per CV bullet: the rows of its three tables. */
export type CvBulletRecord = LocalizedRecord<CvBulletBaseRow>;

/** The tables a bullet's parent lives in, read for the fake's copy of the foreign keys. */
export interface CvBulletParentRecords {
  readonly experienceItems: RecordStore<ExperienceItemRecord>;
  readonly projects: RecordStore<ProjectRecord>;
}

/**
 * The fake adapter of `CvBulletRepository` (ADR-009: fakes at ports). It stores the same rows as
 * the Drizzle adapter, through the same mapper, and mirrors what Postgres does with the parent: a
 * create whose parent is not stored fails (the foreign keys, checked at once), and an update keeps
 * the stored parent columns (the Drizzle update never sets them). Passes the same contract suite as
 * `DrizzleCvBulletRepository`.
 */
export class InMemoryCvBulletRepository extends CvBulletRepository {
  /**
   * @param records the committed records, or a unit of work's staged view of them.
   * @param parents the parents' tables, over the same storage (or staged views of the same run).
   */
  constructor(
    private readonly records: RecordStore<CvBulletRecord> = new InMemoryRecords(),
    private readonly parents: CvBulletParentRecords = {
      experienceItems: new InMemoryRecords(),
      projects: new InMemoryRecords(),
    },
  ) {
    super();
  }

  /**
   * Rebuilds the stored bullet from the revisions its pointers name.
   * @param id the bullet's human id.
   * @returns the bullet, or undefined.
   */
  async get(id: string): Promise<CvBullet | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    return cvBulletFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the bullet's rows when it is still at `expectedVersion`, appending its new revisions; a
   * create checks the parent is stored, an update keeps the stored parent.
   * @param bullet the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new bullet.
   * @throws {Error} when a new bullet's parent is not stored, as the foreign key would.
   */
  async save(bullet: CvBullet, expectedVersion: number): Promise<void> {
    const rows = cvBulletToRows(bullet, expectedVersion + 1);
    const stored = expectedVersion === 0 ? undefined : this.records.read(bullet.id);
    if (expectedVersion === 0) this.assertParentStored(bullet.id, bullet.parent);
    this.records.write(expectedVersion, {
      base: stored
        ? {
            ...rows.base,
            experienceItemId: stored.base.experienceItemId,
            projectId: stored.base.projectId,
          }
        : rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, bullet.id, expectedVersion),
        rows.revisions,
      ),
    });
  }

  private assertParentStored(id: string, parent: CvBulletParent): void {
    const found =
      parent.kind === "experience-item"
        ? this.parents.experienceItems.read(parent.experienceItemId)
        : this.parents.projects.read(parent.projectId);
    if (!found) throw new Error(`The parent ${parent.kind} of CV bullet ${id} is not stored.`);
  }
}
