import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { SkillRepository } from "../application/skill.repository.js";
import type { Skill } from "../domain/skill.js";
import { skillRevisions, skills, skillTranslations } from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import type { TranslationRow } from "./revision-rows.js";
import { skillFromRows, skillToRows } from "./skill-rows.js";

/**
 * The Drizzle adapter of `SkillRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection when `DrizzleContentUnitOfWork` builds it inside `run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleSkillRepository extends SkillRepository {
  private readonly localized: DrizzleLocalizedRows<TranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, skillRevisions, skillTranslations, {});
  }

  /**
   * Reads the root row, the translation rows and the revisions they point at, then rebuilds the
   * skill through the shared mapper.
   * @param id the skill's id.
   * @returns the skill, or undefined when no row has this id.
   */
  async get(id: string): Promise<Skill | undefined> {
    const [base] = await this.db
      .select({
        id: skills.id,
        sortOrder: skills.sortOrder,
        archivedAt: skills.archivedAt,
        version: skills.version,
      })
      .from(skills)
      .where(eq(skills.id, id))
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(id);
    return skillFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.skills` with the
   * layout fields, which takes the row lock; (2) `INSERT` of every unsaved revision; (3) the upsert
   * of every locale's pointers, after the revisions they point at.
   * @param skill the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new skill.
   */
  async save(skill: Skill, expectedVersion: number): Promise<void> {
    const rows = skillToRows(skill, expectedVersion + 1);
    const { id, version: _version, ...layout } = rows.base;
    await compareAndSet(this.db, skills, id, expectedVersion, { id, ...layout }, layout);
    await this.localized.store(rows);
  }
}
