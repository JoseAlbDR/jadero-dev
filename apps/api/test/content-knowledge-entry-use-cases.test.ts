import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ApproveKnowledgeEntry } from "../src/modules/content/application/use-cases/approve-knowledge-entry.use-case.js";
import { CreateKnowledgeEntry } from "../src/modules/content/application/use-cases/create-knowledge-entry.use-case.js";
import { DeleteKnowledgeEntry } from "../src/modules/content/application/use-cases/delete-knowledge-entry.use-case.js";
import { RequestKnowledgeEntryChanges } from "../src/modules/content/application/use-cases/request-knowledge-entry-changes.use-case.js";
import { SaveKnowledgeEntryRevision } from "../src/modules/content/application/use-cases/save-knowledge-entry-revision.use-case.js";
import { SubmitKnowledgeEntry } from "../src/modules/content/application/use-cases/submit-knowledge-entry.use-case.js";
import { WithdrawKnowledgeEntry } from "../src/modules/content/application/use-cases/withdraw-knowledge-entry.use-case.js";
import type { ApprovalChecklist } from "../src/modules/content/domain/approval-checklist.js";
import {
  ChecklistIncomplete,
  ConcurrentModification,
  IdInvalid,
  InvalidTransition,
  ItemNotFound,
  RevisionNotLatest,
} from "../src/modules/content/domain/content.errors.js";
import type {
  KnowledgeEntryDocument,
  KnowledgeEntryProvenance,
} from "../src/modules/content/domain/knowledge-entry.js";
import { type ContentPorts, contentPorts } from "./content-use-case.fakes.js";

// WP-12 step 6: the knowledge entry use cases (their own state machine, D4) on the in-memory unit
// of work: each transition's happy path, a stale expectedVersion, a domain refusal and a missing
// entry, each proving what was left stored. Trace 2a is the stale approval.

const ENTRY = "kb-sample-entry";
const ALL_TICKED: ApprovalChecklist = {
  noClientNames: true,
  noInternalNames: true,
  noNonPublicNumbers: true,
  noEmployerCode: true,
  ownVoice: true,
};

function document(title = "Sample entry"): KnowledgeEntryDocument {
  return {
    title,
    type: "feature",
    domain: "messaging",
    period: { from: "2024-01", to: "2024-03" },
    role: "sole author",
    sections: [
      { key: "summary", body: "Summary." },
      { key: "problem", body: "Problem." },
      { key: "whatHeBuilt", body: "What was built." },
    ],
    questions: ["How does it work?"],
    stack: ["NestJS"],
    patterns: [],
    related: [],
    cvBullet: null,
    indexable: true,
  };
}

const provenance: KnowledgeEntryProvenance = {
  sources: ["notes"],
  conflicts: "",
  publicNames: [],
  confidence: "high",
};

let ports: ContentPorts;
let create: CreateKnowledgeEntry;
let save: SaveKnowledgeEntryRevision;
let submit: SubmitKnowledgeEntry;
let requestChanges: RequestKnowledgeEntryChanges;
let approve: ApproveKnowledgeEntry;
let withdraw: WithdrawKnowledgeEntry;
let remove: DeleteKnowledgeEntry;

beforeEach(() => {
  ports = contentPorts();
  create = new CreateKnowledgeEntry(ports.uow, ports.ids, ports.clock);
  save = new SaveKnowledgeEntryRevision(ports.uow, ports.ids, ports.clock);
  submit = new SubmitKnowledgeEntry(ports.uow);
  requestChanges = new RequestKnowledgeEntryChanges(ports.uow);
  approve = new ApproveKnowledgeEntry(ports.uow, ports.clock);
  withdraw = new WithdrawKnowledgeEntry(ports.uow, ports.clock);
  remove = new DeleteKnowledgeEntry(ports.uow, ports.clock);
});

const storedEntry = () => ports.read((scope) => scope.knowledgeEntries.get(ENTRY));

/** Creates the entry and approves its first revision; returns that revision's id (version 2). */
async function createApproved(): Promise<string> {
  const { revisionId } = await create.execute({ id: ENTRY, document: document(), provenance });
  await approve.execute({ id: ENTRY, revisionId, checklist: ALL_TICKED, expectedVersion: 1 });
  return revisionId;
}

describe("CreateKnowledgeEntry", () => {
  it("creates the entry in draft with its first owner revision, at version 1", async () => {
    const result = await create.execute({ id: ENTRY, document: document(), provenance });
    expect(result).toEqual({
      id: ENTRY,
      revisionId: "0199ffff-0000-7000-8000-000000000001",
      version: 1,
    });
    const entry = await storedEntry();
    expect(entry?.state).toBe("draft");
    expect(entry?.latest()).toMatchObject({ origin: "owner", number: 1, provenance });
  });

  it("stores nothing when the id breaks the kb- format", async () => {
    await expect(
      create.execute({ id: "sample-entry", document: document(), provenance }),
    ).rejects.toThrow(IdInvalid);
    expect(await ports.read((scope) => scope.knowledgeEntries.get("sample-entry"))).toBeUndefined();
  });

  it("refuses a taken id and a command that breaks its schema", async () => {
    await create.execute({ id: ENTRY, document: document(), provenance });
    await expect(create.execute({ id: ENTRY, document: document(), provenance })).rejects.toThrow(
      ConcurrentModification,
    );
    const noProvenance = { id: "kb-other", document: document() } as unknown as Parameters<
      CreateKnowledgeEntry["execute"]
    >[0];
    await expect(create.execute(noProvenance)).rejects.toThrow(ZodError);
  });
});

describe("SaveKnowledgeEntryRevision", () => {
  it("appends revision 2 and keeps the approved one live", async () => {
    const approved = await createApproved();
    const result = await save.execute({
      id: ENTRY,
      document: document("Edited"),
      provenance,
      expectedVersion: 2,
    });
    expect(result).toMatchObject({ id: ENTRY, number: 2, version: 3 });
    const entry = await storedEntry();
    expect(entry?.state).toBe("draft");
    expect(entry?.approvedRevisionId).toBe(approved);
  });

  it("refuses a stale version and an unknown entry, writing nothing", async () => {
    await create.execute({ id: ENTRY, document: document(), provenance });
    await save.execute({ id: ENTRY, document: document("A"), provenance, expectedVersion: 1 });
    await expect(
      save.execute({ id: ENTRY, document: document("B"), provenance, expectedVersion: 1 }),
    ).rejects.toThrow(ConcurrentModification);
    expect((await storedEntry())?.latest().document.title).toBe("A");
    await expect(
      save.execute({ id: "kb-missing", document: document(), provenance, expectedVersion: 1 }),
    ).rejects.toThrow(ItemNotFound);
  });
});

describe("SubmitKnowledgeEntry and RequestKnowledgeEntryChanges", () => {
  it("moves draft to in_review and back, one version each", async () => {
    await create.execute({ id: ENTRY, document: document(), provenance });
    expect(await submit.execute({ id: ENTRY, expectedVersion: 1 })).toEqual({
      id: ENTRY,
      version: 2,
    });
    expect((await storedEntry())?.state).toBe("in_review");
    expect(await requestChanges.execute({ id: ENTRY, expectedVersion: 2 })).toEqual({
      id: ENTRY,
      version: 3,
    });
    expect((await storedEntry())?.state).toBe("draft");
  });

  it("writes nothing on a transition the state machine refuses", async () => {
    await create.execute({ id: ENTRY, document: document(), provenance });
    await expect(requestChanges.execute({ id: ENTRY, expectedVersion: 1 })).rejects.toThrow(
      InvalidTransition,
    );
    await submit.execute({ id: ENTRY, expectedVersion: 1 });
    await expect(submit.execute({ id: ENTRY, expectedVersion: 2 })).rejects.toThrow(
      InvalidTransition,
    );
    expect((await storedEntry())?.version).toBe(2);
  });

  it("refuses a stale version, an unknown entry and a bad command", async () => {
    await create.execute({ id: ENTRY, document: document(), provenance });
    await expect(submit.execute({ id: ENTRY, expectedVersion: 2 })).rejects.toThrow(
      ConcurrentModification,
    );
    expect((await storedEntry())?.state).toBe("draft");
    await expect(submit.execute({ id: "kb-missing", expectedVersion: 1 })).rejects.toThrow(
      ItemNotFound,
    );
    await expect(submit.execute({ id: ENTRY, expectedVersion: 0 })).rejects.toThrow(ZodError);
  });
});

describe("ApproveKnowledgeEntry", () => {
  it("approves the latest revision with every box ticked", async () => {
    const { revisionId } = await create.execute({ id: ENTRY, document: document(), provenance });
    ports.clock.advance(10);
    const result = await approve.execute({
      id: ENTRY,
      revisionId,
      checklist: ALL_TICKED,
      expectedVersion: 1,
    });
    expect(result).toEqual({ entryId: ENTRY, revisionId, alreadyApproved: false });
    const entry = await storedEntry();
    expect(entry?.state).toBe("approved");
    expect(entry?.approval).toEqual({
      revisionId,
      approvedAt: ports.clock.now(),
      checklist: ALL_TICKED,
    });
    expect(entry?.version).toBe(2);
  });

  it("saves nothing and bumps no version when the revision is already the approved one", async () => {
    const revisionId = await createApproved();
    const again = await approve.execute({
      id: ENTRY,
      revisionId,
      checklist: ALL_TICKED,
      expectedVersion: 2,
    });
    expect(again.alreadyApproved).toBe(true);
    expect((await storedEntry())?.version).toBe(2);
  });

  it("refuses a revision that is no longer the latest and writes nothing (Trace 2a)", async () => {
    const { revisionId: reviewed } = await create.execute({
      id: ENTRY,
      document: document(),
      provenance,
    });
    await save.execute({
      id: ENTRY,
      document: document("Re-imported"),
      provenance,
      expectedVersion: 1,
    });
    await expect(
      approve.execute({
        id: ENTRY,
        revisionId: reviewed,
        checklist: ALL_TICKED,
        expectedVersion: 2,
      }),
    ).rejects.toThrow(RevisionNotLatest);
    const entry = await storedEntry();
    expect(entry?.approvedRevisionId).toBeNull();
    expect(entry?.version).toBe(2);
  });

  it("refuses an unticked box, a stale version and an unknown entry", async () => {
    const { revisionId } = await create.execute({ id: ENTRY, document: document(), provenance });
    await expect(
      approve.execute({
        id: ENTRY,
        revisionId,
        checklist: { ...ALL_TICKED, ownVoice: false },
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ChecklistIncomplete);
    await expect(
      approve.execute({ id: ENTRY, revisionId, checklist: ALL_TICKED, expectedVersion: 5 }),
    ).rejects.toThrow(ConcurrentModification);
    expect((await storedEntry())?.approvedRevisionId).toBeNull();
    await expect(
      approve.execute({ id: "kb-missing", revisionId, checklist: ALL_TICKED, expectedVersion: 1 }),
    ).rejects.toThrow(ItemNotFound);
  });
});

describe("WithdrawKnowledgeEntry and DeleteKnowledgeEntry", () => {
  it("withdraw clears the approved pointer at once", async () => {
    await createApproved();
    expect(await withdraw.execute({ id: ENTRY, expectedVersion: 2 })).toEqual({
      id: ENTRY,
      version: 3,
    });
    const entry = await storedEntry();
    expect(entry?.state).toBe("withdrawn");
    expect(entry?.approvedRevisionId).toBeNull();
    expect(entry?.withdrawnAt).toEqual(ports.clock.now());
    await expect(withdraw.execute({ id: ENTRY, expectedVersion: 3 })).rejects.toThrow(
      InvalidTransition,
    );
  });

  it("delete leaves a tombstone that refuses every later transition", async () => {
    await createApproved();
    await remove.execute({ id: ENTRY, expectedVersion: 2 });
    const entry = await storedEntry();
    expect(entry?.deletedAt).toEqual(ports.clock.now());
    expect(entry?.approvedRevisionId).toBeNull();
    await expect(submit.execute({ id: ENTRY, expectedVersion: 3 })).rejects.toThrow(
      InvalidTransition,
    );
    await expect(remove.execute({ id: ENTRY, expectedVersion: 3 })).rejects.toThrow(
      InvalidTransition,
    );
    expect((await storedEntry())?.version).toBe(3);
  });
});
