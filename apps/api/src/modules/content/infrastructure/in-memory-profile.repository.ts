import { ProfileRepository } from "../application/profile.repository.js";
import type { Profile } from "../domain/profile.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";
import { type ProfileBaseRow, profileFromRows, profileToRows } from "./profile-rows.js";

/** What the fake stores for the profile: the rows of its three tables. */
export type ProfileRecord = LocalizedRecord<ProfileBaseRow>;

/** The one key every profile record is kept under: the fake's `profile_singleton` index. */
const PROFILE_KEY = "profile";

/**
 * The fake's profile table: every record under one key, so a create finds any stored profile, even
 * one with another id, and a staged create fails at commit when another run created one meanwhile.
 * @returns an empty table.
 */
export function profileRecords(): InMemoryRecords<ProfileRecord> {
  return new InMemoryRecords<ProfileRecord>(() => PROFILE_KEY);
}

/**
 * The fake adapter of `ProfileRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper, and refuses a second profile as the singleton index
 * does. Passes the same contract suite as `DrizzleProfileRepository`.
 */
export class InMemoryProfileRepository extends ProfileRepository {
  /**
   * @param records the committed records from `profileRecords()`, or a unit of work's staged view
   * of them.
   */
  constructor(private readonly records: RecordStore<ProfileRecord> = profileRecords()) {
    super();
  }

  /**
   * Rebuilds the stored profile from the revisions its pointers name.
   * @returns the profile, or undefined when none was created.
   */
  async find(): Promise<Profile | undefined> {
    const record = this.records.read(PROFILE_KEY);
    if (!record) return undefined;
    return profileFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the profile's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param profile the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for the first profile.
   */
  async save(profile: Profile, expectedVersion: number): Promise<void> {
    const rows = profileToRows(profile, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, PROFILE_KEY, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
