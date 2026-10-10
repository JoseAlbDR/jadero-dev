import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CvBulletRepository } from "../application/cv-bullet.repository.js";
import type { CvBullet } from "../domain/cv-bullet.js";
import { cvBulletRevisions, cvBullets, cvBulletTranslations } from "./content.schema.js";
import { cvBulletFromRows, cvBulletToRows } from "./cv-bullet-rows.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import type { TranslationRow } from "./revision-rows.js";

/**
 * The Drizzle adapter of `CvBulletRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection when `DrizzleContentUnitOfWork` builds it inside `run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleCvBulletRepository extends CvBulletRepository {
  private readonly localized: DrizzleLocalizedRows<TranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, cvBulletRevisions, cvBulletTranslations, {});
  }

  /**
   * Reads the root row, the translation rows and the revisions they point at, then rebuilds the
   * CV bullet through the shared mapper.
   * @param id the CV bullet's id.
   * @returns the CV bullet, or undefined when no row has this id.
   */
  async get(id: string): Promise<CvBullet | undefined> {
    const [base] = await this.db
      .select({
        id: cvBullets.id,
        experienceItemId: cvBullets.experienceItemId,
        projectId: cvBullets.projectId,
        sortOrder: cvBullets.sortOrder,
        importance: cvBullets.importance,
        archivedAt: cvBullets.archivedAt,
        version: cvBullets.version,
      })
      .from(cvBullets)
      .where(eq(cvBullets.id, id))
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(id);
    return cvBulletFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.cv_bullets`, which
   * takes the row lock: a create inserts the parent columns, whose foreign key needs the parent's
   * row already written; an update sets only the order, the importance and the archive mark, never
   * the parent; (2) `INSERT` of every unsaved revision; (3) the upsert of every locale's pointers.
   * @param bullet the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new CV bullet.
   */
  async save(bullet: CvBullet, expectedVersion: number): Promise<void> {
    const rows = cvBulletToRows(bullet, expectedVersion + 1);
    const { id, version: _version, experienceItemId, projectId, ...layout } = rows.base;
    const insert = { id, experienceItemId, projectId, ...layout };
    await compareAndSet(this.db, cvBullets, id, expectedVersion, insert, layout);
    await this.localized.store(rows);
  }
}
