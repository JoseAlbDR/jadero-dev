import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { ProfileRepository } from "../application/profile.repository.js";
import type { Profile } from "../domain/profile.js";
import { profile, profileRevisions, profileTranslations } from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import { profileFromRows, profileToRows } from "./profile-rows.js";
import type { TranslationRow } from "./revision-rows.js";

/**
 * The Drizzle adapter of `ProfileRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection inside `DrizzleContentUnitOfWork.run`. The singleton is the
 * database's: the unique index `profile_singleton` on a constant allows one row. Passes the same
 * contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleProfileRepository extends ProfileRepository {
  private readonly localized: DrizzleLocalizedRows<TranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, profileRevisions, profileTranslations, {});
  }

  /**
   * Reads the only root row, its translation rows and the revisions they point at, then rebuilds
   * the profile through the shared mapper.
   * @returns the profile, or undefined when no row exists yet.
   */
  async find(): Promise<Profile | undefined> {
    const [base] = await this.db
      .select({ id: profile.id, version: profile.version })
      .from(profile)
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(base.id);
    return profileFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.profile`; a create
   * is `INSERT ... ON CONFLICT DO NOTHING` with no conflict target, so a second profile hitting the
   * singleton index is a conflict like a duplicate id (a concurrent first save waits for the
   * other's commit, then inserts nothing); (2) `INSERT` of every unsaved revision; (3) the upsert of
   * every locale's pointers.
   * @param stored the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for the first profile.
   */
  async save(stored: Profile, expectedVersion: number): Promise<void> {
    const rows = profileToRows(stored, expectedVersion + 1);
    const { id } = rows.base;
    await compareAndSet(this.db, profile, id, expectedVersion, { id }, {}, "any");
    await this.localized.store(rows);
  }
}
