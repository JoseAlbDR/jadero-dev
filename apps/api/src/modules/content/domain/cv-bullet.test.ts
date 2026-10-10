import { describe, expect, it } from "vitest";
import {
  IdInvalid,
  InvalidTransition,
  LocaleIncomplete,
  RequiredLocalesMissing,
} from "./content.errors.js";
import { CvBullet, type CvBulletLayout, cvBulletRules } from "./cv-bullet.js";

const AT = new Date("2026-11-03T10:12:00.000Z");
const LATER = new Date("2026-11-04T08:00:00.000Z");
const LAYOUT: CvBulletLayout = {
  id: "backend-10",
  parent: { kind: "experience-item", experienceItemId: "e-1" },
  sortOrder: 3,
  importance: 1,
};

/** A bullet with es r1, en r1 and de r1 saved, nothing published. */
function drafted(): CvBullet {
  const bullet = CvBullet.create(LAYOUT);
  bullet.saveRevision("es", { text: "Construí la bandeja de salida." }, "owner", "es-1", AT);
  bullet.saveRevision("en", { text: "Built the outbox relay." }, "owner", "en-1", AT);
  bullet.saveRevision("de", { text: "Outbox-Relay gebaut." }, "machine", "de-1", AT);
  return bullet;
}

describe("CvBullet", () => {
  it("creates with its layout, version 0 and every locale missing", () => {
    const bullet = CvBullet.create(LAYOUT);
    expect(bullet).toMatchObject(LAYOUT);
    expect(bullet.version).toBe(0);
    expect(bullet.translations.stateOf("en")).toBe("missing");
  });

  it.each`
    parent
    ${{ kind: "experience-item", experienceItemId: "e-1" }}
    ${{ kind: "project", projectId: "p-1" }}
  `("keeps its parent $parent, copied from the input", ({ parent }) => {
    const input = { ...parent };
    const bullet = CvBullet.create({ ...LAYOUT, parent: input });
    input.kind = "changed";
    expect(bullet.parent).toEqual(parent);
    expect(Object.isFrozen(bullet.parent)).toBe(true);
    expect(() => {
      (bullet.parent as { kind: string }).kind = "changed";
    }).toThrow(TypeError);
  });

  it.each(["", "Backend-10", "backend_10", "-backend", "backend--10", "a".repeat(81)])(
    "refuses the id %j",
    (id) => {
      expect(() => CvBullet.create({ ...LAYOUT, id })).toThrow(IdInvalid);
    },
  );

  it.each`
    text         | complete
    ${"A line."} | ${true}
    ${""}        | ${false}
    ${" \n"}     | ${false}
  `("is complete: $complete with text $text", ({ text, complete }) => {
    expect(cvBulletRules.isComplete({ text })).toBe(complete);
    expect(cvBulletRules.invalidFields({ text })).toEqual([]);
  });

  it("saves a blank draft but refuses to publish it", () => {
    const bullet = drafted();
    bullet.saveRevision("en", { text: " " }, "owner", "en-2", AT);
    expect(bullet.translations.stateOf("en")).toBe("draft");
    expect(() => bullet.publish(["es", "en"], AT)).toThrow(LocaleIncomplete);
  });

  it("publishes es and en with a de warning, and refuses one required locale alone", () => {
    const bullet = drafted();
    expect(() => bullet.publish(["en"], AT)).toThrow(RequiredLocalesMissing);

    const result = bullet.publish(["es", "en"], AT);
    expect(result).toEqual({
      itemId: "backend-10",
      published: [
        { locale: "es", revisionId: "es-1" },
        { locale: "en", revisionId: "en-1" },
      ],
      alreadyPublished: [],
      warnings: [{ code: "optional-locale-unpublished", locale: "de" }],
    });
    expect(bullet.translations.stateOf("de")).toBe("draft");
  });

  it("keeps the published text live while a new one is saved, rolls back, and no-ops a repeat", () => {
    const bullet = drafted();
    bullet.publish(["es", "en"], AT);
    const en1 = bullet.translations.published("en");
    bullet.saveRevision("en", { text: "Built and ran the outbox relay." }, "owner", "en-2", AT);
    expect(bullet.translations.stateOf("en")).toBe("changed");

    bullet.publish(["en"], LATER);
    expect(bullet.translations.published("en")?.id).toBe("en-2");

    if (!en1) throw new Error("en-1 was published");
    bullet.publish([{ locale: "en", revision: en1 }], LATER);
    expect(bullet.translations.published("en")?.id).toBe("en-1");
    expect(bullet.translations.stateOf("en")).toBe("changed");

    expect(bullet.publish(["es"], LATER).alreadyPublished).toEqual(["es"]);
  });

  it("archives once and then refuses changes", () => {
    const bullet = drafted();
    bullet.archive(AT);
    expect(bullet.translations.archivedAt()).toEqual(AT);
    expect(() => bullet.archive(AT)).toThrow(InvalidTransition);
    expect(() => bullet.saveRevision("en", { text: "x" }, "owner", "en-2", AT)).toThrow(
      InvalidTransition,
    );
  });

  it("reconstitutes with its stored version, parent and pointers", () => {
    const bullet = CvBullet.reconstitute({
      ...LAYOUT,
      parent: { kind: "project", projectId: "p-1" },
      version: 4,
      translations: { locales: {}, archivedAt: null },
    });
    expect(bullet.version).toBe(4);
    expect(bullet.parent).toEqual({ kind: "project", projectId: "p-1" });
    expect(bullet.translations.latest("es")).toBeNull();
  });
});
