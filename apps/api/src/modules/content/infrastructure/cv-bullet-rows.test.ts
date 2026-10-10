import { describe, expect, it } from "vitest";
import { newCvBullet, saveCvBulletRevision } from "../application/content.contract-fixtures.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { cvBulletFromRows, cvBulletToRows } from "./cv-bullet-rows.js";

const ITEM = "0199c8a0-0000-7000-8000-000000000001";
const PROJECT = "0199c8a0-0000-7000-8000-000000000002";

describe("CV bullet rows", () => {
  it("maps an experience item parent to its column and back", () => {
    const bullet = newCvBullet({ kind: "experience-item", experienceItemId: ITEM });
    saveCvBulletRevision(bullet, "es");
    const rows = cvBulletToRows(bullet, 1);
    expect(rows.base).toMatchObject({ experienceItemId: ITEM, projectId: null, importance: 2 });
    const reloaded = cvBulletFromRows(rows.base, rows.translations, rows.revisions);
    expect(reloaded.snapshot()).toEqual({ ...bullet.snapshot(), version: 1 });
  });

  it("maps a project parent to its column and back", () => {
    const bullet = newCvBullet({ kind: "project", projectId: PROJECT });
    const rows = cvBulletToRows(bullet, 1);
    expect(rows.base).toMatchObject({ experienceItemId: null, projectId: PROJECT });
    expect(cvBulletFromRows(rows.base, [], []).parent).toEqual(bullet.parent);
  });

  it.each([
    ["no parent", { experienceItemId: null, projectId: null }],
    ["two parents", { experienceItemId: ITEM, projectId: PROJECT }],
  ])("refuses a stored row with %s", (_case, parent) => {
    const rows = cvBulletToRows(newCvBullet({ kind: "project", projectId: PROJECT }), 1);
    expect(() => cvBulletFromRows({ ...rows.base, ...parent }, [], [])).toThrow(StoredStateInvalid);
  });

  it("refuses a stored importance outside 1 to 3", () => {
    const rows = cvBulletToRows(newCvBullet({ kind: "project", projectId: PROJECT }), 1);
    expect(() => cvBulletFromRows({ ...rows.base, importance: 4 }, [], [])).toThrow(
      StoredStateInvalid,
    );
  });
});
