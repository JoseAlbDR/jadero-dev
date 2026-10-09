import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ApprovalState, KnowledgeEntryConfidence } from "../domain/knowledge-entry.js";
import { content, oneOf, REVISION_ORIGINS } from "./content.schema.js";

// The knowledge entry tables (WP-12 step 5, ADR-031). Entries are English only, so they have no
// translations table and their revisions no locale column (the repository supplies `en`); approval
// is per entry and bound to one revision, which a composite foreign key proves is the entry's own.
// The private provenance (D-67) lives in its own 1:1 table keyed by the revision, never inside the
// revision document, so no query on revisions can reach it.

/** The approval states (D4), as stored in `knowledge_entries.state`. */
const STATES = [
  "draft",
  "in_review",
  "approved",
  "withdrawn",
] as const satisfies readonly ApprovalState[];

/** How sure the owner is of an entry's sources. */
const CONFIDENCES = [
  "high",
  "medium",
  "low",
] as const satisfies readonly KnowledgeEntryConfidence[];

/**
 * One row per knowledge entry, keyed by its human id (`kb-...`, ADR-031), never deleted so an id is
 * never reused: `deleted_at` is the tombstone. The approval record (revision, time, checklist
 * answers) is set and cleared as one, and `approved` always has it (the same rule `reconstitute`
 * refuses to load without). `cv_bullet` is the approved revision's bullet, copied for the reverse
 * lookup "entries under a bullet"; it has no foreign key, because an entry may name a bullet that
 * does not exist yet (WP-17's coverage view flags it).
 */
export const knowledgeEntries = content.table(
  "knowledge_entries",
  {
    id: text().primaryKey(),
    state: text().notNull(),
    approvedRevisionId: uuid(),
    approvedAt: timestamp({ withTimezone: true }),
    /** The five answers of the approval checklist, as recorded (ADR-031). */
    approvalChecklist: jsonb(),
    cvBullet: text(),
    withdrawnAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    version: integer().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "knowledge_entries_approved_fk",
      columns: [t.id, t.approvedRevisionId],
      foreignColumns: [knowledgeEntryRevisions.entryId, knowledgeEntryRevisions.id],
    }),
    check("knowledge_entries_state_check", oneOf(t.state, STATES)),
    check(
      "knowledge_entries_approval_check",
      sql`num_nulls(${t.approvedRevisionId}, ${t.approvedAt}, ${t.approvalChecklist}) IN (0, 3)`,
    ),
    check(
      "knowledge_entries_approved_state_check",
      sql`${t.state} <> 'approved' OR ${t.approvedRevisionId} IS NOT NULL`,
    ),
    index("knowledge_entries_cv_bullet_idx").on(t.cvBullet),
  ],
);

/**
 * The revisions of every entry: the same immutable `jsonb` snapshot as the localized types, with
 * no locale. The unique `(entry_id, id)` is the target of the approved pointer's foreign key.
 */
export const knowledgeEntryRevisions = content.table(
  "knowledge_entry_revisions",
  {
    /** UUIDv7 from the `IdGenerator` port. */
    id: uuid().primaryKey(),
    entryId: text().notNull(),
    number: integer().notNull(),
    document: jsonb().notNull(),
    origin: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "knowledge_entry_revisions_entry_fk",
      columns: [t.entryId],
      foreignColumns: [knowledgeEntries.id],
    }),
    unique("knowledge_entry_revisions_number_unique").on(t.entryId, t.number),
    unique("knowledge_entry_revisions_pointer_target").on(t.entryId, t.id),
    check("knowledge_entry_revisions_origin_check", oneOf(t.origin, REVISION_ORIGINS)),
    check("knowledge_entry_revisions_number_check", sql`${t.number} >= 1`),
  ],
);

/**
 * The private provenance of one entry revision (D-67): written once with the revision and never
 * changed (append-only, like the revision). Its own table so the public read path cannot select it
 * by accident, and so step 7's read-only role can be denied it with one missing GRANT.
 */
export const knowledgeEntryProvenance = content.table(
  "knowledge_entry_provenance",
  {
    revisionId: uuid().primaryKey(),
    sources: text().array().notNull(),
    conflicts: text().notNull(),
    publicNames: text().array().notNull(),
    confidence: text().notNull(),
  },
  (t) => [
    foreignKey({
      name: "knowledge_entry_provenance_revision_fk",
      columns: [t.revisionId],
      foreignColumns: [knowledgeEntryRevisions.id],
    }),
    check("knowledge_entry_provenance_confidence_check", oneOf(t.confidence, CONFIDENCES)),
  ],
);
