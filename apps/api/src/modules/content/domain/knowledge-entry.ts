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
import type { Period } from "./experience-item.js";
import {
  invalidEntries,
  invalidPeriodFields,
  isCompletePeriod,
  isCvBulletId,
  isFilled,
  isKnowledgeEntryId,
  isSlug,
  isTag,
} from "./field-formats.js";
import type { Locale } from "./locale.js";
import type { DocumentRules } from "./localized-revisions.js";
import type { Revision, RevisionOrigin } from "./revision.js";
import { RevisionHistory, type RevisionHistorySnapshot } from "./revision-history.js";

/** Entries are English only (ADR-031 alignment): every revision is written in this locale. */
export const KNOWLEDGE_ENTRY_LOCALE: Locale = "en";

/** The entry's `type`, the list of the agreed entry format. */
export type KnowledgeEntryType =
  | "feature"
  | "improvement"
  | "tech-debt"
  | "integration"
  | "performance"
  | "tooling"
  | "workshop";

/** The owner's real role in the work, from the agreed entry format. */
export type KnowledgeEntryRole = "sole author" | "lead" | "contributor";

/**
 * The keys of the prose sections in the format's fixed order (ADR-031 alignment). The ninth heading,
 * Questions this answers, is the separate `questions` list.
 */
export const KNOWLEDGE_ENTRY_SECTION_KEYS = [
  "summary",
  "problem",
  "whatHeBuilt",
  "howItWorks",
  "tradeoffs",
  "testingRollout",
  "outcome",
  "lessons",
] as const;

/** One section key. */
export type KnowledgeEntrySectionKey = (typeof KNOWLEDGE_ENTRY_SECTION_KEYS)[number];

/** The sections an approvable entry must have (D-67's tolerant importer); the others may be absent. */
export const REQUIRED_SECTION_KEYS: readonly KnowledgeEntrySectionKey[] = [
  "summary",
  "problem",
  "whatHeBuilt",
];

/** One prose section: its key and its body as raw Markdown. */
export interface KnowledgeEntrySection {
  readonly key: KnowledgeEntrySectionKey;
  readonly body: string;
}

/** How well the sources support the entry; `medium` makes the agent hedge (D-67). */
export type KnowledgeEntryConfidence = "high" | "medium" | "low";

/**
 * One revision of an entry (Q1 B), English only: exactly the fields that are public once the
 * revision is approved, mirroring `KnowledgeEntryDto`, so it can be WP-14's event payload as is.
 * The private fields of the format live apart, in `KnowledgeEntryProvenance` (D-67, defense in
 * depth): a document cannot leak what it does not hold.
 */
export interface KnowledgeEntryDocument {
  readonly title: string;
  readonly type: KnowledgeEntryType;
  /** A kebab-case area (`messaging`); may be empty in a draft. */
  readonly domain: string;
  readonly period: Period;
  readonly role: KnowledgeEntryRole;
  /** In the format's order, each key at most once; empty optional sections are left out. */
  readonly sections: readonly KnowledgeEntrySection[];
  /** The lines under Questions this answers. */
  readonly questions: readonly string[];
  readonly stack: readonly string[];
  readonly patterns: readonly string[];
  /** Other entry ids, by identity (D1). */
  readonly related: readonly string[];
  /** The one CV bullet this entry details (`cv_bullet`), or null; the bullet may not exist yet. */
  readonly cvBullet: string | null;
  /** False asks for a `noindex` page (D-52). */
  readonly indexable: boolean;
}

/**
 * The private provenance of one entry revision (D-67): written with the revision, frozen with it,
 * for the owner only; never shown, never indexed, never in an event, never part of completeness or
 * format checks. Step 5 stores it in its own 1:1 table keyed by revision id (append-only), never as
 * a column of the revision row, so a query or an event built from the revision row cannot carry it.
 */
export interface KnowledgeEntryProvenance {
  /** Where the facts come from. */
  readonly sources: readonly string[];
  /** Notes on sources that disagree. */
  readonly conflicts: string;
  /** The third-party names allowed in the text (the importer's allowlist). */
  readonly publicNames: readonly string[];
  /** How well the sources support the entry; `medium` makes the agent hedge. */
  readonly confidence: KnowledgeEntryConfidence;
}

/** One revision of an entry: its public document and its private provenance. */
export type KnowledgeEntryRevision = Revision<KnowledgeEntryDocument, KnowledgeEntryProvenance>;

function sectionOrderProblems(sections: readonly KnowledgeEntrySection[]): string[] {
  const positions = sections.map((s) => KNOWLEDGE_ENTRY_SECTION_KEYS.indexOf(s.key));
  return positions.flatMap((position, i) =>
    i > 0 && position <= (positions[i - 1] ?? -1) ? [`sections[${i}].key`] : [],
  );
}

/**
 * The rules of an entry document. Format on save: a domain that is a slug when given, a
 * well-formed period, sections in the format's order and each once, tags of 1 to 60 characters,
 * related ids and the CV bullet id in their formats. Complete for approval: what `knowledgeEntryDto`
 * requires (a title, a domain, a start, Summary, Problem and What he built, no blank section, at
 * least one question, none blank). The provenance is not part of the document, so no rule sees it.
 */
export const knowledgeEntryRules: DocumentRules<KnowledgeEntryDocument> = {
  invalidFields: (doc) => [
    ...(isFilled(doc.domain) && !isSlug(doc.domain) ? ["domain"] : []),
    ...invalidPeriodFields(doc.period),
    ...sectionOrderProblems(doc.sections),
    ...invalidEntries("stack", doc.stack, isTag),
    ...invalidEntries("patterns", doc.patterns, isTag),
    ...invalidEntries("related", doc.related, isKnowledgeEntryId),
    ...(doc.cvBullet !== null && !isCvBulletId(doc.cvBullet) ? ["cvBullet"] : []),
  ],
  isComplete: (doc) =>
    isFilled(doc.title) &&
    isSlug(doc.domain) &&
    isCompletePeriod(doc.period) &&
    sectionOrderProblems(doc.sections).length === 0 &&
    REQUIRED_SECTION_KEYS.every((key) => doc.sections.some((s) => s.key === key)) &&
    doc.sections.every((s) => isFilled(s.body)) &&
    doc.questions.length > 0 &&
    doc.questions.every(isFilled),
};

/**
 * The approval state (D4). It describes the latest revision; `approvedRevisionId` describes what is
 * live. They differ on purpose: an approved entry edited again is `draft` with the pointer still set.
 */
export type ApprovalState = "draft" | "in_review" | "approved" | "withdrawn";

/** An approval as recorded: the revision it is bound to, when, and the checklist answers. */
export interface Approval {
  readonly revisionId: string;
  readonly approvedAt: Date;
  readonly checklist: ApprovalChecklist;
}

/**
 * What an approval changed; WP-14 turns a real change into a `knowledge.entry.approved.v1` outbox
 * row. `alreadyApproved` is the empty change set: the revision was already the approved one, so the
 * use case has nothing to save, no version to bump and no event to write.
 */
export interface ApproveResult {
  readonly entryId: string;
  readonly revisionId: string;
  readonly alreadyApproved: boolean;
}

/** The first revision of a new entry, and its identity. */
export interface NewKnowledgeEntry {
  /** The human id (`kb-outbox-relay`), chosen by the owner, never reused. */
  readonly id: string;
  readonly document: KnowledgeEntryDocument;
  readonly provenance: KnowledgeEntryProvenance;
  readonly origin: RevisionOrigin;
  readonly revisionId: string;
  readonly at: Date;
}

/** An entry as a repository reads it back. */
export interface StoredKnowledgeEntry {
  readonly id: string;
  readonly version: number;
  readonly state: ApprovalState;
  readonly approval: Approval | null;
  /** The approved revision's `cvBullet`, copied to the root for the reverse lookup. */
  readonly cvBullet: string | null;
  readonly withdrawnAt: Date | null;
  readonly deletedAt: Date | null;
  /** At least the latest revision, and the approved one when it is older. */
  readonly history: RevisionHistorySnapshot<KnowledgeEntryDocument, KnowledgeEntryProvenance>;
}

/**
 * The knowledge entry aggregate (D1, D4): English only, so one `RevisionHistory` and one approval
 * per entry. Approval is bound to a revision: the owner approves the latest revision they read, with
 * every checklist box ticked, and that revision stays live while newer drafts are written. Withdraw
 * clears the live pointer at once; delete is a withdraw plus a terminal tombstone, after which every
 * transition is refused. Rows are never hard-deleted, so an entry id is never reused (D-65).
 */
export class KnowledgeEntry {
  private constructor(
    readonly id: string,
    readonly version: number,
    private readonly history: RevisionHistory<KnowledgeEntryDocument, KnowledgeEntryProvenance>,
    private current: ApprovalState,
    private approvalRecord: Approval | null,
    private approvedCvBullet: string | null,
    private withdrawnOn: Date | null,
    private deletedOn: Date | null,
  ) {}

  /**
   * Creates an entry with its first revision, in `draft`, at version 0 (never stored). An entry
   * starts with a revision (D4: "[*] --> draft: first revision"), so it always has text to review.
   * @param input the id, the first document (possibly incomplete) and its provenance, its origin,
   * identity and time.
   * @throws {IdInvalid} when the id breaks the `kb-...` format.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  static create(input: NewKnowledgeEntry): KnowledgeEntry {
    if (!isKnowledgeEntryId(input.id)) throw new IdInvalid("knowledge-entry", input.id);
    const entry = new KnowledgeEntry(
      input.id,
      0,
      RevisionHistory.empty(input.id, KNOWLEDGE_ENTRY_LOCALE),
      "draft",
      null,
      null,
      null,
      null,
    );
    entry.append(input.document, input.provenance, input.origin, input.revisionId, input.at);
    return entry;
  }

  /**
   * Rebuilds a stored entry without re-checking its document rules, but refusing a state the machine
   * can never reach, so a repository bug fails at load instead of surfacing later as a wrong answer.
   * @param stored the root row, its version and the revisions it needs.
   * @throws {StoredStateInvalid} when no revision was loaded, the state is `approved` with no
   * approval, or the approval's revision is not among the loaded ones.
   */
  static reconstitute(stored: StoredKnowledgeEntry): KnowledgeEntry {
    const history = RevisionHistory.reconstitute(stored.id, KNOWLEDGE_ENTRY_LOCALE, stored.history);
    if (!history.latest()) throw new StoredStateInvalid(stored.id, "no revision was loaded");
    if (stored.state === "approved" && !stored.approval) {
      throw new StoredStateInvalid(stored.id, "it is approved with no approval");
    }
    if (stored.approval && !history.get(stored.approval.revisionId)) {
      throw new StoredStateInvalid(
        stored.id,
        `its approved revision ${stored.approval.revisionId} was not loaded`,
      );
    }
    return new KnowledgeEntry(
      stored.id,
      stored.version,
      history,
      stored.state,
      stored.approval ? copyApproval(stored.approval) : null,
      stored.cvBullet,
      copy(stored.withdrawnAt),
      copy(stored.deletedAt),
    );
  }

  /** The approval state of the latest revision. */
  get state(): ApprovalState {
    return this.current;
  }

  /** The live revision's id, or null when nothing is approved (never, or withdrawn). */
  get approvedRevisionId(): string | null {
    return this.approvalRecord?.revisionId ?? null;
  }

  /** The live approval (revision, time, checklist answers), or null. */
  get approval(): Approval | null {
    return this.approvalRecord ? copyApproval(this.approvalRecord) : null;
  }

  /** The approved revision's CV bullet id, kept on the root for "entries under a bullet". */
  get cvBullet(): string | null {
    return this.approvedCvBullet;
  }

  /** When the entry was last withdrawn, or null. */
  get withdrawnAt(): Date | null {
    return copy(this.withdrawnOn);
  }

  /** When the entry was deleted (the tombstone), or null. */
  get deletedAt(): Date | null {
    return copy(this.deletedOn);
  }

  /**
   * The newest revision.
   * @returns the latest revision; an entry always has one (`create` appends the first,
   * `reconstitute` refuses an empty history).
   */
  latest(): KnowledgeEntryRevision {
    const latest = this.history.latest();
    if (!latest) throw new StoredStateInvalid(this.id, "it has no revision");
    return latest;
  }

  /**
   * A revision the entry holds, by id: the latest, the approved one, or one saved since loading.
   * @param revisionId the revision's identity.
   * @returns the revision, or null when it is not held.
   */
  revision(revisionId: string): KnowledgeEntryRevision | null {
    return this.history.get(revisionId);
  }

  /**
   * Whether the latest revision could be approved: the completeness the admin shows.
   * @returns true when every field the public contract requires is filled.
   */
  isComplete(): boolean {
    return knowledgeEntryRules.isComplete(this.latest().document);
  }

  /**
   * What a repository stores: the exact mirror of `reconstitute`'s input, at the version it was
   * loaded at (the repository's optimistic check, D5).
   * @returns the root fields and the held revisions, oldest first; dates and the approval are copies.
   */
  snapshot(): StoredKnowledgeEntry {
    return {
      id: this.id,
      version: this.version,
      state: this.current,
      approval: this.approval,
      cvBullet: this.approvedCvBullet,
      withdrawnAt: this.withdrawnAt,
      deletedAt: this.deletedAt,
      history: this.history.snapshot(),
    };
  }

  /**
   * The revisions saved since this entry was created or loaded, which the repository inserts with
   * their provenance rows. After the save the use case discards the entry and the next one loads it
   * again, so there is no "mark saved".
   * @returns them in number order.
   */
  unsavedRevisions(): readonly KnowledgeEntryRevision[] {
    return this.history.unsavedRevisions();
  }

  /**
   * Saves a new revision and moves the entry to `draft` from any state but deleted: `in_review`
   * (a new revision is a change request), `approved` (the approved revision stays live until the new
   * one is approved) and `withdrawn` (the way back, with nothing live).
   * @param document the entry's full public content, possibly incomplete.
   * @param provenance the revision's private provenance, stored with it and never public.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision, now the latest.
   * @throws {InvalidTransition} when the entry is deleted.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  saveRevision(
    document: KnowledgeEntryDocument,
    provenance: KnowledgeEntryProvenance,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): KnowledgeEntryRevision {
    this.assertNotDeleted("save a revision of");
    const revision = this.append(document, provenance, origin, revisionId, at);
    this.current = "draft";
    return revision;
  }

  /**
   * Sends the latest revision for review: `draft` to `in_review`.
   * @throws {InvalidTransition} from any other state, or when deleted.
   */
  submit(): void {
    this.assertState("submit", ["draft"]);
    this.current = "in_review";
  }

  /**
   * Sends a revision under review back for changes: `in_review` to `draft`.
   * @throws {InvalidTransition} from any other state, or when deleted.
   */
  requestChanges(): void {
    this.assertState("request changes to", ["in_review"]);
    this.current = "draft";
  }

  /**
   * Approves the latest revision from `draft` or `in_review` (D4, ADR-031). Guards, in order: the
   * entry is not deleted or withdrawn (a withdrawn entry needs a newer revision, which saving
   * creates and which moves it to `draft`); `revisionId` is the latest (the text the owner read);
   * every checklist box is ticked; the revision is complete. Records the revision, the time and the
   * checklist answers, and copies the revision's `cvBullet` to the root. Approving the revision that
   * is already approved passes the same guards and changes nothing (`alreadyApproved`).
   * @param revisionId the revision the owner reviewed.
   * @param checklist the answers to the five boxes.
   * @param at the approval time, from the use case's clock.
   * @returns the approved revision and whether anything changed.
   * @throws {InvalidTransition} when deleted or withdrawn.
   * @throws {RevisionNotLatest} when a newer revision exists, or the id is not one of this entry.
   * @throws {ChecklistIncomplete} when a box is not ticked.
   * @throws {LocaleIncomplete} when a required field is empty.
   */
  approve(revisionId: string, checklist: ApprovalChecklist, at: Date): ApproveResult {
    this.assertState("approve", ["draft", "in_review", "approved"]);
    const latest = this.latest();
    if (latest.id !== revisionId) throw new RevisionNotLatest(this.id, revisionId, latest.id);
    const unchecked = uncheckedBoxes(checklist);
    if (unchecked.length > 0) throw new ChecklistIncomplete(this.id, unchecked);
    if (!knowledgeEntryRules.isComplete(latest.document)) {
      throw new LocaleIncomplete(this.id, KNOWLEDGE_ENTRY_LOCALE, "approve");
    }

    if (this.current === "approved" && this.approvalRecord?.revisionId === latest.id) {
      return { entryId: this.id, revisionId, alreadyApproved: true };
    }
    this.approvalRecord = copyApproval({ revisionId, approvedAt: at, checklist });
    this.approvedCvBullet = latest.document.cvBullet;
    this.current = "approved";
    return { entryId: this.id, revisionId, alreadyApproved: false };
  }

  /**
   * Withdraws the entry from `draft`, `in_review` or `approved`: the live pointer and the root's CV
   * bullet copy are cleared at once, so public reads and (WP-14) the agent's index drop it.
   * @param at the withdrawal time.
   * @throws {InvalidTransition} when already withdrawn, or deleted.
   */
  withdraw(at: Date): void {
    this.assertState("withdraw", ["draft", "in_review", "approved"]);
    this.approvalRecord = null;
    this.approvedCvBullet = null;
    this.current = "withdrawn";
    this.withdrawnOn = copy(at);
  }

  /**
   * Deletes the entry (D-65): a withdraw, when not already withdrawn, plus a terminal tombstone.
   * The row and its revisions stay, so the id is never reused; every later transition is refused.
   * @param at the deletion time.
   * @throws {InvalidTransition} when already deleted.
   */
  delete(at: Date): void {
    this.assertNotDeleted("delete");
    if (this.current !== "withdrawn") this.withdraw(at);
    this.deletedOn = copy(at);
  }

  private append(
    document: KnowledgeEntryDocument,
    provenance: KnowledgeEntryProvenance,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): KnowledgeEntryRevision {
    const invalid = knowledgeEntryRules.invalidFields(document);
    if (invalid.length > 0) {
      throw new FieldFormatInvalid(this.id, KNOWLEDGE_ENTRY_LOCALE, invalid);
    }
    return this.history.append(document, provenance, origin, revisionId, at);
  }

  private assertState(action: string, from: readonly ApprovalState[]): void {
    this.assertNotDeleted(action);
    if (!from.includes(this.current)) {
      throw new InvalidTransition(this.id, action, `the entry is ${this.current}`);
    }
  }

  private assertNotDeleted(action: string): void {
    if (this.deletedOn) throw new InvalidTransition(this.id, action, "the entry is deleted");
  }
}

function copyApproval(approval: Approval): Approval {
  return Object.freeze({
    revisionId: approval.revisionId,
    approvedAt: new Date(approval.approvedAt.getTime()),
    checklist: Object.freeze(
      Object.fromEntries(
        APPROVAL_CHECKS.map((check) => [check, approval.checklist[check] === true]),
      ),
    ) as ApprovalChecklist,
  });
}

function copy(date: Date | null): Date | null {
  return date ? new Date(date.getTime()) : null;
}
