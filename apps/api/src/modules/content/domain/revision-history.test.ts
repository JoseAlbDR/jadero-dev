import { describe, expect, it } from "vitest";
import { Revision } from "./revision.js";
import { RevisionHistory } from "./revision-history.js";

interface Doc {
  title: string;
}

const ITEM = "item-1";
const AT = new Date("2026-11-03T10:12:00.000Z");

function rev(
  number: number,
  over: Partial<{ id: string; itemId: string; locale: "en" | "es" }> = {},
) {
  return Revision.reconstitute<Doc>({
    id: over.id ?? `r${number}`,
    itemId: over.itemId ?? ITEM,
    locale: over.locale ?? "en",
    number,
    origin: "owner",
    document: { title: `text ${number}` },
    provenance: null,
    createdAt: AT,
  });
}

describe("RevisionHistory", () => {
  it("starts empty", () => {
    const history = RevisionHistory.empty<Doc>(ITEM, "en");
    expect(history.latest()).toBeNull();
    expect(history.get("r1")).toBeNull();
    expect(history.snapshot()).toEqual({ revisions: [] });
    expect(history.belongs(rev(1))).toBe(false);
  });

  it("appends numbered, frozen revisions that carry the item, locale and origin", () => {
    const history = RevisionHistory.empty<Doc>(ITEM, "en");
    const input = { title: "first" };
    const first = history.append(input, null, "owner", "a", AT);
    const second = history.append({ title: "second" }, null, "machine", "b", AT);
    input.title = "changed by the caller";

    expect(first).toMatchObject({
      id: "a",
      itemId: ITEM,
      locale: "en",
      number: 1,
      origin: "owner",
    });
    expect(second).toMatchObject({ id: "b", number: 2, origin: "machine" });
    expect(first.document.title).toBe("first");
    expect(Object.isFrozen(first.document)).toBe(true);
    expect(history.latest()).toBe(second);
    expect(history.get("a")).toBe(first);
    expect(history.snapshot().revisions.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("reconstitutes from loaded revisions in any order, the highest number being the latest", () => {
    const history = RevisionHistory.reconstitute<Doc>(ITEM, "en", { revisions: [rev(4), rev(2)] });
    expect(history.latest()?.id).toBe("r4");
    expect(history.get("r2")?.number).toBe(2);
    expect(history.get("r3")).toBeNull();
    expect(history.append({ title: "next" }, null, "owner", "r5", AT).number).toBe(5);
    expect(history.snapshot().revisions.map((r) => r.id)).toEqual(["r2", "r4", "r5"]);
  });

  it.each`
    case                        | revision                        | belongs
    ${"the latest"}             | ${rev(4)}                       | ${true}
    ${"an older, unloaded one"} | ${rev(3)}                       | ${true}
    ${"a newer one"}            | ${rev(5)}                       | ${false}
    ${"another item's"}         | ${rev(3, { itemId: "item-2" })} | ${false}
    ${"another locale's"}       | ${rev(3, { locale: "es" })}     | ${false}
    ${"same number, other id"}  | ${rev(4, { id: "other" })}      | ${false}
  `("belongs: $belongs for $case", ({ revision, belongs }) => {
    const history = RevisionHistory.reconstitute<Doc>(ITEM, "en", { revisions: [rev(4)] });
    expect(history.belongs(revision)).toBe(belongs);
  });
});

describe("RevisionHistory persistence view", () => {
  it("lists only the revisions appended since it was loaded, in number order", () => {
    const history = RevisionHistory.reconstitute<Doc>(ITEM, "en", { revisions: [rev(4)] });
    expect(history.unsavedRevisions()).toEqual([]);
    history.append({ title: "five" }, null, "owner", "r5", AT);
    history.append({ title: "six" }, null, "machine", "r6", AT);
    expect(history.unsavedRevisions().map((r) => [r.id, r.number])).toEqual([
      ["r5", 5],
      ["r6", 6],
    ]);
  });

  it("round-trips through its snapshot, and a reloaded history has nothing unsaved", () => {
    const history = RevisionHistory.reconstitute<Doc>(ITEM, "en", { revisions: [rev(4), rev(2)] });
    history.append({ title: "five" }, null, "owner", "r5", AT);
    const reloaded = RevisionHistory.reconstitute<Doc>(ITEM, "en", history.snapshot());
    expect(reloaded.snapshot()).toEqual(history.snapshot());
    expect(reloaded.latest()?.id).toBe("r5");
    expect(reloaded.unsavedRevisions()).toEqual([]);
  });
});

describe("Revision", () => {
  it("keeps its creation time when the given or the returned Date is changed", () => {
    const given = new Date(AT.getTime());
    const revision = RevisionHistory.empty<Doc>(ITEM, "en").append(
      { title: "t" },
      null,
      "owner",
      "a",
      given,
    );
    given.setFullYear(2000);
    revision.createdAt.setFullYear(2001);
    expect(revision.createdAt).toEqual(AT);
    expect(Object.isFrozen(revision)).toBe(true);
  });

  it("carries a frozen copy of its provenance", () => {
    const provenance = { sources: ["notes"] };
    const revision = RevisionHistory.empty<Doc, { sources: string[] }>(ITEM, "en").append(
      { title: "t" },
      provenance,
      "owner",
      "a",
      AT,
    );
    provenance.sources.push("changed by the caller");
    expect(revision.provenance).toEqual({ sources: ["notes"] });
    expect(Object.isFrozen(revision.provenance.sources)).toBe(true);
  });
});
