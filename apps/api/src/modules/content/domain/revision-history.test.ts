import { describe, expect, it } from "vitest";
import { Revision } from "./revision.js";
import { RevisionHistory } from "./revision-history.js";

interface Doc {
  title: string;
}

const ITEM = "item-1";
const AT = new Date("2026-11-03T10:12:00.000Z");

function rev(number: number, over: Partial<{ itemId: string; locale: "en" | "es" }> = {}) {
  return Revision.reconstitute<Doc>({
    id: `r${number}`,
    itemId: over.itemId ?? ITEM,
    locale: over.locale ?? "en",
    number,
    origin: "owner",
    document: { title: `text ${number}` },
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
    const first = history.append(input, "owner", "a", AT);
    const second = history.append({ title: "second" }, "machine", "b", AT);
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
    expect(history.append({ title: "next" }, "owner", "r5", AT).number).toBe(5);
    expect(history.snapshot().revisions.map((r) => r.id)).toEqual(["r2", "r4", "r5"]);
  });

  it.each`
    case                        | revision                        | belongs
    ${"the latest"}             | ${rev(4)}                       | ${true}
    ${"an older, unloaded one"} | ${rev(3)}                       | ${true}
    ${"a newer one"}            | ${rev(5)}                       | ${false}
    ${"another item's"}         | ${rev(3, { itemId: "item-2" })} | ${false}
    ${"another locale's"}       | ${rev(3, { locale: "es" })}     | ${false}
    ${"same number, other id"}  | ${{ ...rev(4), id: "other" }}   | ${false}
  `("belongs: $belongs for $case", ({ revision, belongs }) => {
    const history = RevisionHistory.reconstitute<Doc>(ITEM, "en", { revisions: [rev(4)] });
    expect(history.belongs(revision)).toBe(belongs);
  });
});
