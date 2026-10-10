import { describe, expect, it } from "vitest";
import { at, newProfile, saveProfileRevision } from "../application/content.contract-fixtures.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { Profile } from "../domain/profile.js";
import { profileFromRows, profileToRows } from "./profile-rows.js";

describe("profile rows", () => {
  it("round-trips a profile through its rows, never archived", () => {
    const profile = newProfile();
    saveProfileRevision(profile, "es");
    const rows = profileToRows(profile, 1);
    expect(rows.base).toEqual({ id: profile.id, version: 1 });
    const reloaded = profileFromRows(rows.base, rows.translations, rows.revisions);
    expect(reloaded.snapshot()).toEqual({ ...profile.snapshot(), version: 1 });
    expect(reloaded.translations.archivedAt()).toBeNull();
  });

  it("refuses to write an archive mark instead of dropping it: the table has no column for it", () => {
    const stored = newProfile().snapshot();
    const archived = Profile.reconstitute({
      ...stored,
      translations: { ...stored.translations, archivedAt: at(1) },
    });
    expect(() => profileToRows(archived, 1)).toThrow(StoredStateInvalid);
  });
});
