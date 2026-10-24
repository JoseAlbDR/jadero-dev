import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { NowRepository } from "../application/now.repository.js";
import type { Now } from "../domain/now.js";
import { now, nowRevisions, nowTranslations } from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import { nowFromRows, nowToRows } from "./now-rows.js";
import type { TranslationRow } from "./revision-rows.js";

/**
 * The Drizzle adapter of `NowRepository` (ADR-005, WP-39 D2), on the pool (`DRIZZLE`) or on a
 * transaction's connection inside `DrizzleContentUnitOfWork.run`. The singleton is the database's:
 * the unique index `now_singleton` on a constant allows one row. Passes the same contract suite as
 * the in-memory fake.
 */
@Injectable()
export class DrizzleNowRepository extends NowRepository {
  private readonly localized: DrizzleLocalizedRows<TranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, nowRevisions, nowTranslations, {});
  }

  /**
   * Reads the only root row, its translation rows and the revisions they point at, then rebuilds
   * the Now page through the shared mapper.
   * @returns the Now page, or undefined when no row exists yet.
   */
  async find(): Promise<Now | undefined> {
    const [base] = await this.db.select({ id: now.id, version: now.version }).from(now).limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(base.id);
    return nowFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.now`; a create is
   * `INSERT ... ON CONFLICT DO NOTHING` with no conflict target, so a second Now page hitting the
   * singleton index is a conflict like a duplicate id; (2) `INSERT` of every unsaved revision;
   * (3) the upsert of every locale's pointers.
   * @param stored the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for the first Now page.
   */
  async save(stored: Now, expectedVersion: number): Promise<void> {
    const rows = nowToRows(stored, expectedVersion + 1);
    const { id } = rows.base;
    await compareAndSet(this.db, now, id, expectedVersion, { id }, {}, "any");
    await this.localized.store(rows);
  }
}
