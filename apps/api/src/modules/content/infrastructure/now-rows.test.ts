import { describe, expect, it } from "vitest";
import { at, newNow, saveNowRevision } from "../application/content.contract-fixtures.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { Now } from "../domain/now.js";
import { nowFromRows, nowToRows } from "./now-rows.js";

describe("now rows", () => {
  it("round-trips a Now page through its rows, never archived", () => {
    const now = newNow();
    saveNowRevision(now, "es");
    const rows = nowToRows(now, 1);
    expect(rows.base).toEqual({ id: now.id, version: 1 });
    const reloaded = nowFromRows(rows.base, rows.translations, rows.revisions);
    expect(reloaded.snapshot()).toEqual({ ...now.snapshot(), version: 1 });
    expect(reloaded.translations.archivedAt()).toBeNull();
  });

  it("refuses to write an archive mark instead of dropping it: the table has no column for it", () => {
    const stored = newNow().snapshot();
    const archived = Now.reconstitute({
      ...stored,
      translations: { ...stored.translations, archivedAt: at(1) },
    });
    expect(() => nowToRows(archived, 1)).toThrow(StoredStateInvalid);
  });
});
