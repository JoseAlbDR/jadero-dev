import { describe, expect, it } from "vitest";
import {
  InvalidTransition,
  LocaleIncomplete,
  RequiredLocalesMissing,
  RevisionNotOfItem,
} from "./content.errors.js";
import type { Locale } from "./locale.js";
import {
  type LocaleSnapshot,
  type LocaleState,
  LocalizedRevisions,
} from "./localized-revisions.js";
import { Revision } from "./revision.js";

interface Doc {
  title: string;
}

const ITEM = "item-1";
const SAVED = new Date("2026-11-01T09:00:00.000Z");
const NOW = new Date("2026-11-03T10:12:00.000Z");
const complete = (doc: Doc) => doc.title.trim().length > 0;

function rev(locale: Locale, number: number, title = `${locale} text ${number}`): Revision<Doc> {
  return Revision.reconstitute({
    id: `${locale}-r${number}`,
    itemId: ITEM,
    locale,
    number,
    origin: "owner",
    document: { title },
    createdAt: SAVED,
  });
}

/**
 * A stored locale in a given state: `draft` has r1 unpublished, `published` has r1 published and
 * latest, `changed` has r1 published and r2 latest.
 */
function slot(locale: Locale, state: LocaleState): LocaleSnapshot<Doc> | undefined {
  const at = new Date("2026-10-20T08:00:00.000Z");
  switch (state) {
    case "missing":
      return undefined;
    case "draft":
      return { latest: rev(locale, 1), published: null, publishedAt: null };
    case "published":
      return { latest: rev(locale, 1), published: rev(locale, 1), publishedAt: at };
    case "changed":
      return { latest: rev(locale, 2), published: rev(locale, 1), publishedAt: at };
  }
}

function machine(states: Partial<Record<Locale, LocaleState>>, archivedAt: Date | null = null) {
  const locales: Partial<Record<Locale, LocaleSnapshot<Doc>>> = {};
  for (const [locale, state] of Object.entries(states) as [Locale, LocaleState][]) {
    const stored = slot(locale, state);
    if (stored) locales[locale] = stored;
  }
  return LocalizedRevisions.reconstitute<Doc>(ITEM, complete, { locales, archivedAt });
}

const BOTH_REQUIRED_PUBLISHED = { es: "published", en: "published" } as const;

describe("LocalizedRevisions", () => {
  it("starts with every locale missing and not archived", () => {
    const empty = LocalizedRevisions.empty<Doc>(ITEM, complete);
    for (const locale of ["es", "en", "de"] as const) {
      expect(empty.stateOf(locale)).toBe("missing");
      expect(empty.latest(locale)).toBeNull();
      expect(empty.published(locale)).toBeNull();
      expect(empty.publishedAt(locale)).toBeNull();
      expect(empty.isComplete(locale)).toBe(false);
    }
    expect(empty.archivedAt()).toBeNull();
  });

  describe("saveRevision (append)", () => {
    it.each`
      from           | to           | number | published
      ${"missing"}   | ${"draft"}   | ${1}   | ${null}
      ${"draft"}     | ${"draft"}   | ${2}   | ${null}
      ${"published"} | ${"changed"} | ${2}   | ${"de-r1"}
      ${"changed"}   | ${"changed"} | ${3}   | ${"de-r1"}
    `("moves $from to $to as revision $number", ({ from, to, number, published }) => {
      const m = machine({ ...BOTH_REQUIRED_PUBLISHED, de: from });
      const saved = m.append("de", { title: "Jobportal" }, "owner", "de-new", NOW);

      expect(m.stateOf("de")).toBe(to);
      expect(saved).toMatchObject({ id: "de-new", itemId: ITEM, locale: "de", number });
      expect(m.latest("de")).toBe(saved);
      expect(m.published("de")?.id ?? null).toBe(published);
    });

    it("numbers each locale on its own", () => {
      const m = machine({ es: "changed", en: "missing" });
      expect(m.append("es", { title: "a" }, "owner", "es-3", NOW).number).toBe(3);
      expect(m.append("en", { title: "b" }, "owner", "en-1", NOW).number).toBe(1);
    });

    it.each(["owner", "machine"] as const)("keeps the origin %s and the save time", (origin) => {
      const m = LocalizedRevisions.empty<Doc>(ITEM, complete);
      const saved = m.append("de", { title: "Jobportal" }, origin, "de-1", NOW);
      expect(saved.origin).toBe(origin);
      expect(saved.createdAt).toEqual(NOW);
    });

    it("accepts an incomplete draft and reports it as incomplete", () => {
      const m = LocalizedRevisions.empty<Doc>(ITEM, complete);
      m.append("es", { title: " " }, "owner", "es-1", NOW);
      expect(m.stateOf("es")).toBe("draft");
      expect(m.isComplete("es")).toBe(false);
    });

    it("stores a frozen copy: neither the caller nor anyone else can change a revision", () => {
      const m = LocalizedRevisions.empty<Doc>(ITEM, complete);
      const input = { title: "first" };
      const saved = m.append("es", input, "owner", "es-1", NOW);
      input.title = "changed later";

      expect(saved.document.title).toBe("first");
      expect(Object.isFrozen(saved)).toBe(true);
      expect(Object.isFrozen(saved.document)).toBe(true);
    });
  });

  describe("publish the latest revision", () => {
    it.each`
      from           | outcome
      ${"missing"}   | ${LocaleIncomplete}
      ${"draft"}     | ${"published"}
      ${"published"} | ${InvalidTransition}
      ${"changed"}   | ${"published"}
    `("de $from gives $outcome", ({ from, outcome }) => {
      const m = machine({ ...BOTH_REQUIRED_PUBLISHED, de: from });
      if (typeof outcome === "string") {
        const result = m.publish(["de"], NOW);
        expect(m.stateOf("de")).toBe(outcome);
        expect(result.published).toEqual([{ locale: "de", revisionId: m.latest("de")?.id }]);
        expect(m.publishedAt("de")).toEqual(NOW);
      } else {
        expect(() => m.publish(["de"], NOW)).toThrow(outcome);
        expect(m.stateOf("de")).toBe(from);
      }
    });

    it("refuses a locale whose latest revision is incomplete", () => {
      const m = machine(BOTH_REQUIRED_PUBLISHED);
      m.append("de", { title: "" }, "owner", "de-1", NOW);
      expect(() => m.publish(["de"], NOW)).toThrow(LocaleIncomplete);
      expect(m.stateOf("de")).toBe("draft");
    });

    it("leaves the publish time of the other locales alone", () => {
      const m = machine({ es: "changed", en: "published" });
      m.publish(["es"], NOW);
      expect(m.publishedAt("en")).toEqual(new Date("2026-10-20T08:00:00.000Z"));
    });
  });

  describe("required locales (D-20)", () => {
    it.each`
      states                                       | targets   | missing
      ${{ es: "draft", en: "draft" }}              | ${["es"]} | ${["en"]}
      ${{ es: "draft", en: "draft" }}              | ${["en"]} | ${["es"]}
      ${{ es: "draft", en: "draft", de: "draft" }} | ${["de"]} | ${["es", "en"]}
      ${{ es: "draft", en: "missing" }}            | ${["es"]} | ${["en"]}
      ${{ es: "published", en: "draft" }}          | ${["de"]} | ${["en"]}
    `("refuses $targets from $states: $missing missing", ({ states, targets, missing }) => {
      const m = machine({ de: "draft", ...states });
      const error = catchError(() => m.publish(targets, NOW));
      expect(error).toBeInstanceOf(RequiredLocalesMissing);
      expect((error as RequiredLocalesMissing).missing).toEqual(missing);
      expect(m.published("es")?.id ?? null).toBe(states.es === "published" ? "es-r1" : null);
    });

    it.each`
      states                                               | targets               | warnings
      ${{ es: "draft", en: "draft" }}                      | ${["es", "en"]}       | ${["de"]}
      ${{ es: "draft", en: "draft", de: "draft" }}         | ${["es", "en"]}       | ${["de"]}
      ${{ es: "draft", en: "draft", de: "draft" }}         | ${["es", "en", "de"]} | ${[]}
      ${{ es: "changed", en: "published" }}                | ${["es"]}             | ${["de"]}
      ${{ es: "published", en: "draft" }}                  | ${["en"]}             | ${["de"]}
      ${{ es: "published", en: "published", de: "draft" }} | ${["de"]}             | ${[]}
      ${{ es: "changed", en: "published", de: "changed" }} | ${["es"]}             | ${[]}
    `("publishes $targets from $states, warning $warnings", ({ states, targets, warnings }) => {
      const m = machine(states);
      const result = m.publish(targets, NOW);
      expect(result.itemId).toBe(ITEM);
      expect(result.published.map((p) => p.locale)).toEqual(targets);
      expect(result.warnings).toEqual(
        warnings.map((locale: Locale) => ({ code: "optional-locale-unpublished", locale })),
      );
      for (const locale of targets as Locale[]) expect(m.stateOf(locale)).toBe("published");
    });

    it("is all or nothing: one incomplete locale publishes none", () => {
      const m = machine({ es: "draft" });
      m.append("en", { title: "" }, "owner", "en-1", NOW);
      expect(() => m.publish(["es", "en"], NOW)).toThrow(LocaleIncomplete);
      expect(m.stateOf("es")).toBe("draft");
    });
  });

  describe("rollback: publishing an older revision (D2)", () => {
    /** es published at r2 (the latest), with r1 before it; en published. */
    function publishedAtTwo() {
      return LocalizedRevisions.reconstitute<Doc>(ITEM, complete, {
        locales: {
          es: { latest: rev("es", 2), published: rev("es", 2), publishedAt: SAVED },
          en: slot("en", "published") as LocaleSnapshot<Doc>,
        },
        archivedAt: null,
      });
    }

    it("moves published to changed: the pointer goes back, the latest stays", () => {
      const m = publishedAtTwo();
      const result = m.publish([{ locale: "es", revision: rev("es", 1) }], NOW);
      expect(m.stateOf("es")).toBe("changed");
      expect(m.published("es")?.number).toBe(1);
      expect(m.latest("es")?.number).toBe(2);
      expect(result.published).toEqual([{ locale: "es", revisionId: "es-r1" }]);
    });

    it("keeps changed as changed when an even older revision is published", () => {
      const m = LocalizedRevisions.reconstitute<Doc>(ITEM, complete, {
        locales: {
          es: { latest: rev("es", 3), published: rev("es", 2), publishedAt: SAVED },
          en: slot("en", "published") as LocaleSnapshot<Doc>,
        },
        archivedAt: null,
      });
      m.publish([{ locale: "es", revision: rev("es", 1) }], NOW);
      expect(m.stateOf("es")).toBe("changed");
      expect(m.published("es")?.number).toBe(1);
    });

    it("accepts the latest revision given explicitly", () => {
      const m = machine({ es: "changed", en: "published" });
      m.publish([{ locale: "es", revision: rev("es", 2) }], NOW);
      expect(m.stateOf("es")).toBe("published");
    });

    it("refuses the revision that is already published", () => {
      const m = machine({ es: "changed", en: "published" });
      expect(() => m.publish([{ locale: "es", revision: rev("es", 1) }], NOW)).toThrow(
        InvalidTransition,
      );
    });

    it("refuses an older revision that is incomplete", () => {
      const m = publishedAtTwo();
      expect(() => m.publish([{ locale: "es", revision: rev("es", 1, "") }], NOW)).toThrow(
        LocaleIncomplete,
      );
      expect(m.published("es")?.number).toBe(2);
    });

    it.each`
      case                                  | revision
      ${"of another item"}                  | ${Revision.reconstitute({ ...rev("es", 1), itemId: "item-2" })}
      ${"of another locale"}                | ${rev("en", 1)}
      ${"newer than the latest"}            | ${rev("es", 3)}
      ${"numbered as the latest, other id"} | ${Revision.reconstitute({ ...rev("es", 2), id: "es-other" })}
    `("refuses a revision $case", ({ revision }) => {
      const m = publishedAtTwo();
      expect(() => m.publish([{ locale: "es", revision }], NOW)).toThrow(RevisionNotOfItem);
    });

    it("refuses a revision for a locale with none", () => {
      const m = machine(BOTH_REQUIRED_PUBLISHED);
      expect(() => m.publish([{ locale: "de", revision: rev("de", 1) }], NOW)).toThrow(
        RevisionNotOfItem,
      );
    });
  });

  describe("malformed publish requests", () => {
    it("refuses an empty list", () => {
      expect(() => machine(BOTH_REQUIRED_PUBLISHED).publish([], NOW)).toThrow(InvalidTransition);
    });

    it("refuses a locale named twice", () => {
      const m = machine({ es: "draft", en: "draft" });
      expect(() => m.publish(["es", "en", { locale: "es", revision: rev("es", 1) }], NOW)).toThrow(
        InvalidTransition,
      );
    });
  });

  describe("archive", () => {
    it("hides every locale at once and keeps the pointers", () => {
      const m = machine({ es: "published", en: "changed", de: "draft" });
      m.archive(NOW);
      expect(m.archivedAt()).toEqual(NOW);
      expect(m.published("es")?.id).toBe("es-r1");
      expect(m.stateOf("en")).toBe("changed");
    });

    it.each`
      action            | run
      ${"archive"}      | ${(m: LocalizedRevisions<Doc>) => m.archive(NOW)}
      ${"saveRevision"} | ${(m: LocalizedRevisions<Doc>) => m.append("de", { title: "x" }, "owner", "de-2", NOW)}
      ${"publish"}      | ${(m: LocalizedRevisions<Doc>) => m.publish(["de"], NOW)}
    `("refuses $action once archived", ({ run }) => {
      const m = machine({ ...BOTH_REQUIRED_PUBLISHED, de: "draft" }, SAVED);
      expect(() => run(m)).toThrow(InvalidTransition);
      expect(m.stateOf("de")).toBe("draft");
    });
  });

  it("does not share dates with the caller", () => {
    const archivedAt = new Date(SAVED.getTime());
    const m = machine(BOTH_REQUIRED_PUBLISHED, archivedAt);
    archivedAt.setFullYear(2000);
    (m.archivedAt() as Date).setFullYear(2001);
    (m.publishedAt("es") as Date).setFullYear(2001);
    expect(m.archivedAt()).toEqual(SAVED);
    expect(m.publishedAt("es")).toEqual(new Date("2026-10-20T08:00:00.000Z"));
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected an error");
}
