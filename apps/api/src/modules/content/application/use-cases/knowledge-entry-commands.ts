import { z } from "zod";
import type { ApprovalChecklist } from "../../domain/approval-checklist.js";
import { ItemNotFound } from "../../domain/content.errors.js";
import type {
  KnowledgeEntry,
  KnowledgeEntryDocument,
  KnowledgeEntryProvenance,
} from "../../domain/knowledge-entry.js";
import type { ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  approvalChecklistSchema,
  knowledgeEntryDocumentSchema,
  knowledgeEntryProvenanceSchema,
} from "../content-documents.js";

// The commands of the knowledge entry use cases. Entries keep their own use cases (owner decision):
// English only, approved per entry with the checklist (ADR-031), not published per locale.

/** The entry's human id (`kb-...`); its format is the domain's rule, checked on create. */
const entryId = z.string().min(1).max(120);
const expectedVersion = z.int().min(1);

/** Creates an entry with its first revision. */
export interface CreateKnowledgeEntryCommand {
  readonly id: string;
  readonly document: KnowledgeEntryDocument;
  readonly provenance: KnowledgeEntryProvenance;
}

/** Validates `CreateKnowledgeEntryCommand`. */
export const createKnowledgeEntryCommand: z.ZodType<CreateKnowledgeEntryCommand> = z.object({
  id: entryId,
  document: knowledgeEntryDocumentSchema,
  provenance: knowledgeEntryProvenanceSchema,
});

/** Saves a new revision of an entry, with its private provenance. */
export interface SaveKnowledgeEntryRevisionCommand extends CreateKnowledgeEntryCommand {
  readonly expectedVersion: number;
}

/** Validates `SaveKnowledgeEntryRevisionCommand`. */
export const saveKnowledgeEntryRevisionCommand: z.ZodType<SaveKnowledgeEntryRevisionCommand> =
  z.object({
    id: entryId,
    document: knowledgeEntryDocumentSchema,
    provenance: knowledgeEntryProvenanceSchema,
    expectedVersion,
  });

/** Approves one revision of an entry with the five-box checklist (D4, ADR-031). */
export interface ApproveKnowledgeEntryCommand {
  readonly id: string;
  /** The revision the owner reviewed; it must still be the latest (Trace 2a). */
  readonly revisionId: string;
  readonly checklist: ApprovalChecklist;
  readonly expectedVersion: number;
}

/** Validates `ApproveKnowledgeEntryCommand`. */
export const approveKnowledgeEntryCommand: z.ZodType<ApproveKnowledgeEntryCommand> = z.object({
  id: entryId,
  revisionId: z.uuid(),
  checklist: approvalChecklistSchema,
  expectedVersion,
});

/** A transition with no data of its own: submit, request changes, withdraw, delete. */
export interface KnowledgeEntryTransitionCommand {
  readonly id: string;
  readonly expectedVersion: number;
}

/** Validates `KnowledgeEntryTransitionCommand`. */
export const knowledgeEntryTransitionCommand: z.ZodType<KnowledgeEntryTransitionCommand> = z.object(
  { id: entryId, expectedVersion },
);

/** What a change of an entry stored: the entry and its new version. */
export interface ChangedKnowledgeEntry {
  readonly id: string;
  readonly version: number;
}

/**
 * Loads a stored entry or fails.
 * @param scope the unit of work's repositories.
 * @param id the entry's id.
 * @returns the entry.
 * @throws {ItemNotFound} when no entry has the id.
 */
export async function loadKnowledgeEntry(scope: ContentScope, id: string): Promise<KnowledgeEntry> {
  const entry = await scope.knowledgeEntries.get(id);
  if (!entry) throw new ItemNotFound("knowledge-entry", id);
  return entry;
}

/**
 * The one flow of every entry transition without data of its own: validate, load, apply the
 * domain method, save with the caller's version, all in one transaction.
 * @param uow the module's unit of work.
 * @param command the entry and the version the caller loaded.
 * @param transition the domain method to apply.
 * @returns the entry and its new version.
 * @throws {ZodError} when the command breaks its schema; nothing runs.
 * @throws {ItemNotFound} when no entry has the id.
 * @throws {InvalidTransition} from the domain; nothing is stored.
 * @throws {ConcurrentModification} when the entry is no longer at `expectedVersion`.
 */
export async function transitionKnowledgeEntry(
  uow: ContentUnitOfWork,
  command: KnowledgeEntryTransitionCommand,
  transition: (entry: KnowledgeEntry) => void,
): Promise<ChangedKnowledgeEntry> {
  const parsed = knowledgeEntryTransitionCommand.parse(command);
  return uow.run(async (scope) => {
    const entry = await loadKnowledgeEntry(scope, parsed.id);
    transition(entry);
    await scope.knowledgeEntries.save(entry, parsed.expectedVersion);
    return { id: entry.id, version: parsed.expectedVersion + 1 };
  });
}
