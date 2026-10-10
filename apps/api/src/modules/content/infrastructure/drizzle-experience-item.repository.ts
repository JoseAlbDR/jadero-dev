import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ExperienceItemRepository } from "../application/experience-item.repository.js";
import type { ExperienceItem } from "../domain/experience-item.js";
import {
  experienceItemRevisions,
  experienceItems,
  experienceItemTranslations,
} from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import { experienceItemFromRows, experienceItemToRows } from "./experience-item-rows.js";
import type { TranslationRow } from "./revision-rows.js";

/**
 * The Drizzle adapter of `ExperienceItemRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection when `DrizzleContentUnitOfWork` builds it inside `run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleExperienceItemRepository extends ExperienceItemRepository {
  private readonly localized: DrizzleLocalizedRows<TranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(
      this.db,
      experienceItemRevisions,
      experienceItemTranslations,
      {},
    );
  }

  /**
   * Reads the root row, the translation rows and the revisions they point at, then rebuilds the
   * experience item through the shared mapper.
   * @param id the experience item's id.
   * @returns the experience item, or undefined when no row has this id.
   */
  async get(id: string): Promise<ExperienceItem | undefined> {
    const [base] = await this.db
      .select({
        id: experienceItems.id,
        sortOrder: experienceItems.sortOrder,
        archivedAt: experienceItems.archivedAt,
        version: experienceItems.version,
      })
      .from(experienceItems)
      .where(eq(experienceItems.id, id))
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(id);
    return experienceItemFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.experience_items` with the
   * layout fields, which takes the row lock; (2) `INSERT` of every unsaved revision; (3) the upsert
   * of every locale's pointers, after the revisions they point at.
   * @param item the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new experience item.
   */
  async save(item: ExperienceItem, expectedVersion: number): Promise<void> {
    const rows = experienceItemToRows(item, expectedVersion + 1);
    const { id, version: _version, ...layout } = rows.base;
    await compareAndSet(this.db, experienceItems, id, expectedVersion, { id, ...layout }, layout);
    await this.localized.store(rows);
  }
}
