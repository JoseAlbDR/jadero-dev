import { describe, expect, it } from "vitest";
import { APPROVAL_CHECKS, type ApprovalChecklist, uncheckedBoxes } from "./approval-checklist.js";
import {
  ChecklistIncomplete,
  FieldFormatInvalid,
  IdInvalid,
  InvalidTransition,
  LocaleIncomplete,
  RevisionNotLatest,
  StoredStateInvalid,
} from "./content.errors.js";
import {
  type ApprovalState,
  KnowledgeEntry,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
  type KnowledgeEntryRevision,
  knowledgeEntryRules,
  type StoredKnowledgeEntry,
} from "./knowledge-entry.js";
import { Revision } from "./revision.js";

const ID = "kb-outbox-relay";
const SAVED = new Date("2026-11-01T09:00:00.000Z");
const APPROVED_AT = new Date("2026-11-02T09:00:00.000Z");
const NOW = new Date("2026-11-03T10:12:00.000Z");

const ALL_TICKED: ApprovalChecklist = {
  noClientNames: true,
  noInternalNames: true,
  noNonPublicNumbers: true,
  noEmployerCode: true,
  ownVoice: true,
};

function doc(over: Partial<KnowledgeEntryDocument> = {}): KnowledgeEntryDocument {
  return {
    title: "Outbox relay",
    type: "feature",
    domain: "messaging",
    period: { from: "2025-03", to: "2025-05" },
    role: "sole author",
    sections: [
      { key: "summary", body: "A relay that publishes outbox rows." },
      { key: "problem", body: "Events were lost on crashes." },
      { key: "whatHeBuilt", body: "A polling relay with confirms." },
      { key: "tradeoffs", body: "Polling over logical decoding." },
    ],
    questions: ["How are events kept from being lost?"],
    stack: ["NestJS", "RabbitMQ"],
    patterns: ["outbox"],
    related: ["kb-inbox-dedup"],
    cvBullet: "backend-10",
    indexable: true,
    ...over,
  };
}

function prov(over: Partial<KnowledgeEntryProvenance> = {}): KnowledgeEntryProvenance {
  return {
    sources: ["design notes"],
    conflicts: "",
    publicNames: ["RabbitMQ"],
    confidence: "high",
    ...over,
  };
}

function rev(number: number, document = doc()): KnowledgeEntryRevision {
  return Revision.reconstitute({
    id: `r${number}`,
    itemId: ID,
    locale: "en",
    number,
    origin: "owner",
    document,
    provenance: prov(),
    createdAt: SAVED,
  });
}

/** The fixtures of the transition table: each state as a repository would read it back. */
type Fixture = ApprovalState | "approved-then-edited" | "deleted";

function entryIn(fixture: Fixture): KnowledgeEntry {
  const approval = { revisionId: "r1", approvedAt: APPROVED_AT, checklist: ALL_TICKED };
  const base = {
    id: ID,
    version: 3,
    approval: null,
    cvBullet: null,
    withdrawnAt: null,
    deletedAt: null,
    history: { revisions: [rev(1)] },
  };
  switch (fixture) {
    case "draft":
    case "in_review":
      return KnowledgeEntry.reconstitute({ ...base, state: fixture });
    case "approved":
      return KnowledgeEntry.reconstitute({
        ...base,
        state: "approved",
        approval,
        cvBullet: "backend-10",
      });
    case "approved-then-edited":
      return KnowledgeEntry.reconstitute({
        ...base,
        state: "draft",
        approval,
        cvBullet: "backend-10",
        history: { revisions: [rev(1), rev(2)] },
      });
    case "withdrawn":
      return KnowledgeEntry.reconstitute({ ...base, state: "withdrawn", withdrawnAt: SAVED });
    case "deleted":
      return KnowledgeEntry.reconstitute({
        ...base,
        state: "withdrawn",
        withdrawnAt: SAVED,
        deletedAt: SAVED,
      });
  }
}

type Action = "save" | "submit" | "requestChanges" | "approve" | "withdraw" | "delete";

function act(entry: KnowledgeEntry, action: Action): void {
  switch (action) {
    case "save":
      entry.saveRevision(doc({ title: "Edited" }), prov(), "owner", "r-new", NOW);
      return;
    case "submit":
      entry.submit();
      return;
    case "requestChanges":
      entry.requestChanges();
      return;
    case "approve":
      entry.approve(entry.latest().id, ALL_TICKED, NOW);
      return;
    case "withdraw":
      entry.withdraw(NOW);
      return;
    case "delete":
      entry.delete(NOW);
      return;
  }
}

/** Everything a transition may change, to prove a refused one changed nothing. */
function observable(entry: KnowledgeEntry) {
  return {
    state: entry.state,
    latest: entry.latest().id,
    approval: entry.approval,
    cvBullet: entry.cvBullet,
    withdrawnAt: entry.withdrawnAt,
    deletedAt: entry.deletedAt,
  };
}

const X = InvalidTransition;

describe("KnowledgeEntry approval machine (D4)", () => {
  it.each`
    from                      | action              | to
    ${"draft"}                | ${"save"}           | ${"draft"}
    ${"draft"}                | ${"submit"}         | ${"in_review"}
    ${"draft"}                | ${"requestChanges"} | ${X}
    ${"draft"}                | ${"approve"}        | ${"approved"}
    ${"draft"}                | ${"withdraw"}       | ${"withdrawn"}
    ${"draft"}                | ${"delete"}         | ${"withdrawn"}
    ${"in_review"}            | ${"save"}           | ${"draft"}
    ${"in_review"}            | ${"submit"}         | ${X}
    ${"in_review"}            | ${"requestChanges"} | ${"draft"}
    ${"in_review"}            | ${"approve"}        | ${"approved"}
    ${"in_review"}            | ${"withdraw"}       | ${"withdrawn"}
    ${"in_review"}            | ${"delete"}         | ${"withdrawn"}
    ${"approved"}             | ${"save"}           | ${"draft"}
    ${"approved"}             | ${"submit"}         | ${X}
    ${"approved"}             | ${"requestChanges"} | ${X}
    ${"approved"}             | ${"approve"}        | ${"approved"}
    ${"approved"}             | ${"withdraw"}       | ${"withdrawn"}
    ${"approved"}             | ${"delete"}         | ${"withdrawn"}
    ${"approved-then-edited"} | ${"submit"}         | ${"in_review"}
    ${"approved-then-edited"} | ${"approve"}        | ${"approved"}
    ${"approved-then-edited"} | ${"withdraw"}       | ${"withdrawn"}
    ${"withdrawn"}            | ${"save"}           | ${"draft"}
    ${"withdrawn"}            | ${"submit"}         | ${X}
    ${"withdrawn"}            | ${"requestChanges"} | ${X}
    ${"withdrawn"}            | ${"approve"}        | ${X}
    ${"withdrawn"}            | ${"withdraw"}       | ${X}
    ${"withdrawn"}            | ${"delete"}         | ${"withdrawn"}
    ${"deleted"}              | ${"save"}           | ${X}
    ${"deleted"}              | ${"submit"}         | ${X}
    ${"deleted"}              | ${"requestChanges"} | ${X}
    ${"deleted"}              | ${"approve"}        | ${X}
    ${"deleted"}              | ${"withdraw"}       | ${X}
    ${"deleted"}              | ${"delete"}         | ${X}
  `("$from --$action--> $to", ({ from, action, to }) => {
    const entry = entryIn(from);
    if (to === X) {
      const before = observable(entry);
      expect(() => act(entry, action)).toThrow(InvalidTransition);
      expect(observable(entry)).toEqual(before);
    } else {
      act(entry, action);
      expect(entry.state).toBe(to);
      expect(entry.deletedAt).toEqual(action === "delete" ? NOW : null);
    }
  });

  it("creates in draft with revision 1 and no approval", () => {
    const entry = KnowledgeEntry.create({
      id: ID,
      document: doc(),
      provenance: prov(),
      origin: "machine",
      revisionId: "r1",
      at: SAVED,
    });
    expect(entry.state).toBe("draft");
    expect(entry.version).toBe(0);
    expect(entry.latest()).toMatchObject({ id: "r1", number: 1, locale: "en", origin: "machine" });
    expect(entry.approvedRevisionId).toBeNull();
    expect(entry.snapshot().history.revisions.map((r) => r.id)).toEqual(["r1"]);
  });

  it.each(["outbox-relay", "kb-", "kb-Outbox", "kb--relay", `kb-${"a".repeat(118)}`])(
    "refuses the id %j",
    (id) => {
      const create = () =>
        KnowledgeEntry.create({
          id,
          document: doc(),
          provenance: prov(),
          origin: "owner",
          revisionId: "r1",
          at: SAVED,
        });
      expect(create).toThrow(IdInvalid);
    },
  );

  it("refuses a malformed first revision", () => {
    const create = () =>
      KnowledgeEntry.create({
        id: ID,
        document: doc({ domain: "Not A Slug" }),
        provenance: prov(),
        origin: "owner",
        revisionId: "r1",
        at: SAVED,
      });
    expect(create).toThrow(FieldFormatInvalid);
  });

  it("an edit after approval keeps the approved revision live until the new one is approved", () => {
    const entry = entryIn("approved");
    entry.saveRevision(doc({ cvBullet: "backend-11" }), prov(), "owner", "r2", NOW);
    expect(entry.state).toBe("draft");
    expect(entry.approvedRevisionId).toBe("r1");
    expect(entry.cvBullet).toBe("backend-10");
    expect(entry.revision("r1")?.number).toBe(1);

    const result = entry.approve("r2", ALL_TICKED, NOW);
    expect(result).toEqual({ entryId: ID, revisionId: "r2", alreadyApproved: false });
    expect(entry.approval).toEqual({ revisionId: "r2", approvedAt: NOW, checklist: ALL_TICKED });
    expect(entry.cvBullet).toBe("backend-11");
  });

  it("approving the approved revision again is a no-op that keeps the first approval", () => {
    const entry = entryIn("approved");
    expect(entry.approve("r1", ALL_TICKED, NOW)).toEqual({
      entryId: ID,
      revisionId: "r1",
      alreadyApproved: true,
    });
    expect(entry.approval?.approvedAt).toEqual(APPROVED_AT);
  });

  it("a repeat approval still checks the guards", () => {
    const entry = entryIn("approved");
    expect(() => entry.approve("r1", { ...ALL_TICKED, ownVoice: false }, NOW)).toThrow(
      ChecklistIncomplete,
    );
  });

  it("withdraw clears the live pointer and the CV bullet copy at once", () => {
    const entry = entryIn("approved-then-edited");
    entry.withdraw(NOW);
    expect(entry.approvedRevisionId).toBeNull();
    expect(entry.approval).toBeNull();
    expect(entry.cvBullet).toBeNull();
    expect(entry.withdrawnAt).toEqual(NOW);
  });

  it("delete of a withdrawn entry keeps the withdrawal time and adds the tombstone", () => {
    const entry = entryIn("withdrawn");
    entry.delete(NOW);
    expect(entry.withdrawnAt).toEqual(SAVED);
    expect(entry.deletedAt).toEqual(NOW);
  });

  it("a withdrawn revision cannot be approved again; only a newer revision can (Q2 a)", () => {
    const entry = entryIn("approved");
    entry.withdraw(NOW);
    expect(() => entry.approve("r1", ALL_TICKED, NOW)).toThrow(InvalidTransition);

    entry.saveRevision(doc({ title: "Rewritten" }), prov(), "owner", "r2", NOW);
    expect(entry.state).toBe("draft");
    expect(() => entry.approve("r1", ALL_TICKED, NOW)).toThrow(RevisionNotLatest);
    expect(entry.approve("r2", ALL_TICKED, NOW).alreadyApproved).toBe(false);
    expect(entry.approvedRevisionId).toBe("r2");
  });
});

describe("KnowledgeEntry approval guards", () => {
  it.each`
    case                   | revisionId
    ${"an older revision"} | ${"r1"}
    ${"an unknown id"}     | ${"r9"}
  `("refuses $case with RevisionNotLatest and changes nothing", ({ revisionId }) => {
    const entry = entryIn("approved-then-edited");
    const before = observable(entry);
    expect(() => entry.approve(revisionId, ALL_TICKED, NOW)).toThrow(RevisionNotLatest);
    expect(observable(entry)).toEqual(before);
  });

  it.each(APPROVAL_CHECKS)("refuses an approval with %s unticked", (check) => {
    const entry = entryIn("in_review");
    const before = observable(entry);
    const checklist = { ...ALL_TICKED, [check]: false };
    expect(() => entry.approve("r1", checklist, NOW)).toThrow(ChecklistIncomplete);
    expect(observable(entry)).toEqual(before);
  });

  it("counts a missing or non-true box as unticked", () => {
    const partial = { noClientNames: true, ownVoice: "yes" } as unknown as ApprovalChecklist;
    expect(uncheckedBoxes(partial)).toEqual([
      "noInternalNames",
      "noNonPublicNumbers",
      "noEmployerCode",
      "ownVoice",
    ]);
    expect(uncheckedBoxes(ALL_TICKED)).toEqual([]);
  });

  it("records only the five answers", () => {
    const entry = entryIn("draft");
    const extra = { ...ALL_TICKED, sneaky: true } as ApprovalChecklist;
    entry.approve("r1", extra, NOW);
    expect(entry.approval?.checklist).toEqual(ALL_TICKED);
  });

  it("refuses to approve an incomplete revision with LocaleIncomplete", () => {
    const entry = entryIn("draft");
    entry.saveRevision(doc({ questions: [] }), prov(), "owner", "r2", NOW);
    expect(entry.isComplete()).toBe(false);
    expect(() => entry.approve("r2", ALL_TICKED, NOW)).toThrow(LocaleIncomplete);
    expect(entry.state).toBe("draft");
  });

  it("reconstitutes with its version, dates and approval copied", () => {
    const entry = entryIn("approved-then-edited");
    expect(entry.version).toBe(3);
    expect(entry.latest().id).toBe("r2");
    expect(entry.approval?.approvedAt).toEqual(APPROVED_AT);
    expect(entry.snapshot().history.revisions.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("knowledgeEntryRules", () => {
  const sections = doc().sections;

  it.each`
    case                               | over                                                                       | complete
    ${"the full document"}             | ${{}}                                                                      | ${true}
    ${"blank title"}                   | ${{ title: " " }}                                                          | ${false}
    ${"empty domain"}                  | ${{ domain: "" }}                                                          | ${false}
    ${"empty start"}                   | ${{ period: { from: "", to: null } }}                                      | ${false}
    ${"no Problem section"}            | ${{ sections: sections.filter((s) => s.key !== "problem") }}               | ${false}
    ${"blank optional section"}        | ${{ sections: [...sections.slice(0, 3), { key: "outcome", body: "\n" }] }} | ${false}
    ${"no optional section"}           | ${{ sections: sections.slice(0, 3) }}                                      | ${true}
    ${"no question"}                   | ${{ questions: [] }}                                                       | ${false}
    ${"a blank question"}              | ${{ questions: ["Why?", " "] }}                                            | ${false}
    ${"no CV bullet, nothing related"} | ${{ cvBullet: null, related: [], stack: [], patterns: [] }}                | ${true}
  `("is complete: $complete with $case", ({ over, complete }) => {
    expect(knowledgeEntryRules.isComplete(doc(over))).toBe(complete);
  });

  it.each`
    over                                                 | fields
    ${{ domain: "Not A Slug" }}                          | ${["domain"]}
    ${{ period: { from: "2025-05", to: "2025-03" } }}    | ${["period.to"]}
    ${{ period: { from: "2025-5", to: null } }}          | ${["period.from"]}
    ${{ sections: [sections[1], sections[0]] }}          | ${["sections[1].key"]}
    ${{ sections: [sections[0], sections[0]] }}          | ${["sections[1].key"]}
    ${{ stack: ["ok", ""], patterns: ["x".repeat(61)] }} | ${["stack[1]", "patterns[0]"]}
    ${{ related: ["kb-ok", "outbox"] }}                  | ${["related[1]"]}
    ${{ cvBullet: "Backend 10" }}                        | ${["cvBullet"]}
  `("refuses to save $over", ({ over, fields }) => {
    expect(knowledgeEntryRules.invalidFields(doc(over))).toEqual(fields);
    const entry = entryIn("draft");
    expect(() => entry.saveRevision(doc(over), prov(), "owner", "r2", NOW)).toThrow(
      FieldFormatInvalid,
    );
    expect(entry.latest().id).toBe("r1");
  });

  it("saves an incomplete draft whose filled fields are well formed", () => {
    const draft = doc({ title: "", domain: "", period: { from: "", to: null }, sections: [] });
    expect(knowledgeEntryRules.invalidFields(draft)).toEqual([]);
    const entry = entryIn("draft");
    entry.saveRevision({ ...draft, questions: [] }, prov(), "owner", "r2", NOW);
    expect(entry.isComplete()).toBe(false);
  });
});

describe("KnowledgeEntry provenance (D-67)", () => {
  it("keeps the provenance on the revision, apart from the public document, as a frozen copy", () => {
    const provenance = { ...prov({ confidence: "medium" }), sources: ["notes"] };
    const entry = KnowledgeEntry.create({
      id: ID,
      document: doc(),
      provenance,
      origin: "owner",
      revisionId: "r1",
      at: SAVED,
    });
    provenance.sources.push("changed by the caller");
    const revision = entry.latest();
    expect(revision.provenance).toEqual(prov({ sources: ["notes"], confidence: "medium" }));
    expect(Object.isFrozen(revision.provenance)).toBe(true);
    for (const key of ["sources", "conflicts", "publicNames", "confidence"]) {
      expect(revision.document).not.toHaveProperty(key);
    }
  });

  it("approves whatever the provenance says: no rule reads it", () => {
    const entry = entryIn("draft");
    entry.saveRevision(
      doc(),
      prov({ sources: [], publicNames: [], confidence: "low" }),
      "owner",
      "r2",
      NOW,
    );
    expect(entry.approve("r2", ALL_TICKED, NOW).alreadyApproved).toBe(false);
  });
});

describe("KnowledgeEntry persistence view", () => {
  it("lists the revisions saved since creation, and none after a reload", () => {
    const entry = KnowledgeEntry.create({
      id: ID,
      document: doc(),
      provenance: prov(),
      origin: "owner",
      revisionId: "r1",
      at: SAVED,
    });
    expect(entry.unsavedRevisions().map((r) => r.id)).toEqual(["r1"]);
    expect(KnowledgeEntry.reconstitute(entry.snapshot()).unsavedRevisions()).toEqual([]);
  });

  it("lists two saves in one use case with consecutive numbers", () => {
    const entry = entryIn("approved");
    entry.saveRevision(doc({ title: "Second" }), prov(), "owner", "r2", NOW);
    entry.saveRevision(doc({ title: "Third" }), prov(), "machine", "r3", NOW);
    expect(entry.unsavedRevisions().map((r) => [r.id, r.number])).toEqual([
      ["r2", 2],
      ["r3", 3],
    ]);
  });

  it.each<Fixture>(["draft", "approved", "approved-then-edited", "withdrawn", "deleted"])(
    "round-trips %s through its snapshot",
    (fixture) => {
      const entry = entryIn(fixture);
      const reloaded = KnowledgeEntry.reconstitute(entry.snapshot());
      expect(reloaded.snapshot()).toEqual(entry.snapshot());
      expect(observable(reloaded)).toEqual(observable(entry));
    },
  );

  it("round-trips an entry approved in memory", () => {
    const entry = entryIn("draft");
    entry.saveRevision(doc({ title: "Second" }), prov(), "owner", "r2", NOW);
    entry.approve("r2", ALL_TICKED, NOW);
    const reloaded = KnowledgeEntry.reconstitute(entry.snapshot());
    expect(reloaded.snapshot()).toEqual(entry.snapshot());
    expect(reloaded.approvedRevisionId).toBe("r2");
  });

  const stored = (over: Partial<StoredKnowledgeEntry>): StoredKnowledgeEntry => ({
    ...entryIn("approved").snapshot(),
    ...over,
  });

  it.each`
    case                                     | input
    ${"no revision loaded"}                  | ${stored({ history: { revisions: [] } })}
    ${"approved with no approval"}           | ${stored({ approval: null })}
    ${"an approval of an unloaded revision"} | ${stored({ history: { revisions: [rev(2)] } })}
  `("refuses to reconstitute $case", ({ input }) => {
    expect(() => KnowledgeEntry.reconstitute(input)).toThrow(StoredStateInvalid);
  });
});
