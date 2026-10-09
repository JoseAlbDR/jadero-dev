import { z } from "zod";
import { APPROVAL_CHECKS, type ApprovalChecklist } from "../domain/approval-checklist.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import {
  type ApprovalState,
  KNOWLEDGE_ENTRY_LOCALE,
  KNOWLEDGE_ENTRY_SECTION_KEYS,
  KnowledgeEntry,
  type KnowledgeEntryConfidence,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
  type KnowledgeEntryRevision,
  type KnowledgeEntryRole,
  type KnowledgeEntryType,
} from "../domain/knowledge-entry.js";
import { readStored, revisionFromRow } from "./revision-rows.js";

/** The keys of a union as the tuple `z.enum` takes; the `satisfies` below makes each list complete. */
function keysOf<T extends string>(record: Record<T, true>): [T, ...T[]] {
  return Object.keys(record) as [T, ...T[]];
}

const entryTypes = {
  feature: true,
  improvement: true,
  "tech-debt": true,
  integration: true,
  performance: true,
  tooling: true,
  workshop: true,
} as const satisfies Record<KnowledgeEntryType, true>;

const entryRoles = {
  "sole author": true,
  lead: true,
  contributor: true,
} as const satisfies Record<KnowledgeEntryRole, true>;

const confidences = {
  high: true,
  medium: true,
  low: true,
} as const satisfies Record<KnowledgeEntryConfidence, true>;

const approvalStates = {
  draft: true,
  in_review: true,
  approved: true,
  withdrawn: true,
} as const satisfies Record<ApprovalState, true>;

/**
 * The stored shape of an entry revision's document (Q1 B): only the public fields; the provenance
 * has its own table. Structure only: format and completeness are the domain's rules.
 */
export const knowledgeEntryDocumentSchema: z.ZodType<KnowledgeEntryDocument> = z.object({
  title: z.string(),
  type: z.enum(keysOf(entryTypes)),
  domain: z.string(),
  period: z.object({ from: z.string(), to: z.string().nullable() }),
  role: z.enum(keysOf(entryRoles)),
  sections: z.array(z.object({ key: z.enum(KNOWLEDGE_ENTRY_SECTION_KEYS), body: z.string() })),
  questions: z.array(z.string()),
  stack: z.array(z.string()),
  patterns: z.array(z.string()),
  related: z.array(z.string()),
  cvBullet: z.string().nullable(),
  indexable: z.boolean(),
});

const provenanceSchema: z.ZodType<KnowledgeEntryProvenance> = z.object({
  sources: z.array(z.string()),
  conflicts: z.string(),
  publicNames: z.array(z.string()),
  confidence: z.enum(keysOf(confidences)),
});

const checklistSchema: z.ZodType<ApprovalChecklist> = z.object({
  noClientNames: z.boolean(),
  noInternalNames: z.boolean(),
  noNonPublicNumbers: z.boolean(),
  noEmployerCode: z.boolean(),
  ownVoice: z.boolean(),
} satisfies Record<(typeof APPROVAL_CHECKS)[number], z.ZodBoolean>);

const stateSchema = z.enum(keysOf(approvalStates));

/** The approval columns of a `content.knowledge_entries` row, written after the revisions. */
export interface KnowledgeEntryStateColumns {
  readonly state: string;
  readonly approvedRevisionId: string | null;
  readonly approvedAt: Date | null;
  /** The checklist answers as stored (`jsonb`): unknown until parsed. */
  readonly approvalChecklist: unknown;
  readonly cvBullet: string | null;
  readonly withdrawnAt: Date | null;
  readonly deletedAt: Date | null;
}

/** A `content.knowledge_entries` row. */
export interface KnowledgeEntryBaseRow extends KnowledgeEntryStateColumns {
  readonly id: string;
  readonly version: number;
}

/** A `content.knowledge_entry_revisions` row: no locale column (English only). */
export interface KnowledgeEntryRevisionRow {
  readonly id: string;
  readonly entryId: string;
  readonly number: number;
  readonly document: unknown;
  readonly origin: string;
  readonly createdAt: Date;
}

/** A `content.knowledge_entry_provenance` row: one per revision, private (D-67). */
export interface ProvenanceRow {
  readonly revisionId: string;
  readonly sources: string[];
  readonly conflicts: string;
  readonly publicNames: string[];
  readonly confidence: string;
}

/** A loaded revision with its provenance row, or null when that row is missing. */
export interface LoadedEntryRevision {
  readonly revision: KnowledgeEntryRevisionRow;
  readonly provenance: ProvenanceRow | null;
}

/** What one entry save writes. */
export interface KnowledgeEntryRows {
  readonly base: KnowledgeEntryBaseRow;
  /** Only the revisions saved since the entry was loaded, inserted (append-only). */
  readonly revisions: readonly KnowledgeEntryRevisionRow[];
  /** One per new revision, inserted with it. */
  readonly provenance: readonly ProvenanceRow[];
}

/**
 * The rows of an entry at its next version: its approval state, its new revisions and, apart, their
 * provenance, so the revision row never holds a private field.
 * @param entry the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, the unsaved revisions and their provenance rows.
 */
export function knowledgeEntryToRows(entry: KnowledgeEntry, version: number): KnowledgeEntryRows {
  const stored = entry.snapshot();
  const unsaved = entry.unsavedRevisions();
  return {
    base: {
      id: stored.id,
      version,
      state: stored.state,
      approvedRevisionId: stored.approval?.revisionId ?? null,
      approvedAt: stored.approval?.approvedAt ?? null,
      approvalChecklist: stored.approval ? checklistSchema.parse(stored.approval.checklist) : null,
      cvBullet: stored.cvBullet,
      withdrawnAt: stored.withdrawnAt,
      deletedAt: stored.deletedAt,
    },
    revisions: unsaved.map((revision) => ({
      id: revision.id,
      entryId: revision.itemId,
      number: revision.number,
      document: knowledgeEntryDocumentSchema.parse(revision.document),
      origin: revision.origin,
      createdAt: revision.createdAt,
    })),
    provenance: unsaved.map(({ id, provenance }) => ({
      revisionId: id,
      sources: [...provenance.sources],
      conflicts: provenance.conflicts,
      publicNames: [...provenance.publicNames],
      confidence: provenance.confidence,
    })),
  };
}

/**
 * Which stored revisions an entry loads (D1): the latest, and the approved one when it is older.
 * The in-memory fake's copy of the Drizzle repository's query.
 * @param revisions every stored revision of the entry.
 * @param approvedRevisionId the root's approved pointer.
 * @returns the revisions to load.
 */
export function entryRevisionsToLoad<T extends { readonly id: string; readonly number: number }>(
  revisions: readonly T[],
  approvedRevisionId: string | null,
): T[] {
  const latest = Math.max(...revisions.map((revision) => revision.number));
  return revisions.filter(
    (revision) => revision.number === latest || revision.id === approvedRevisionId,
  );
}

/**
 * Rebuilds an entry from its rows: each document, provenance, the checklist and the state parsed,
 * revisions in `en` (the mapper supplies the locale the table does not have). `reconstitute` then
 * refuses the states the machine never reaches.
 * @param base the root row.
 * @param loaded the latest revision and the approved one, each with its provenance row.
 * @returns the entry at the stored version.
 * @throws {StoredStateInvalid} when a row cannot be read back or a provenance row is missing.
 */
export function knowledgeEntryFromRows(
  base: KnowledgeEntryBaseRow,
  loaded: readonly LoadedEntryRevision[],
): KnowledgeEntry {
  const revisions: KnowledgeEntryRevision[] = loaded.map(({ revision, provenance }) => {
    if (!provenance) {
      throw new StoredStateInvalid(base.id, `revision ${revision.id} has no provenance`);
    }
    const { revisionId: _, ...fields } = provenance;
    return revisionFromRow(
      { ...revision, itemId: revision.entryId, locale: KNOWLEDGE_ENTRY_LOCALE },
      knowledgeEntryDocumentSchema,
      readStored(provenanceSchema, fields, base.id, `revision ${revision.id} provenance`),
    );
  });
  return KnowledgeEntry.reconstitute({
    id: base.id,
    version: base.version,
    state: readStored(stateSchema, base.state, base.id, "state"),
    approval: approvalFromRow(base),
    cvBullet: base.cvBullet,
    withdrawnAt: base.withdrawnAt,
    deletedAt: base.deletedAt,
    history: { revisions },
  });
}

function approvalFromRow(base: KnowledgeEntryBaseRow) {
  if (!base.approvedRevisionId) return null;
  if (!base.approvedAt) throw new StoredStateInvalid(base.id, "its approval has no time");
  return {
    revisionId: base.approvedRevisionId,
    approvedAt: base.approvedAt,
    checklist: readStored(checklistSchema, base.approvalChecklist, base.id, "approval checklist"),
  };
}
