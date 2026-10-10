import { Injectable } from "@nestjs/common";
import type { ApproveResult } from "../../domain/knowledge-entry.js";
import { Clock } from "../clock.js";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type ApproveKnowledgeEntryCommand,
  approveKnowledgeEntryCommand,
  loadKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/**
 * Approves one revision of an entry (D4, ADR-031): the revision the owner reviewed, still the
 * latest (Trace 2a), with every checklist box ticked. Approving the live revision again changes
 * nothing, so nothing is saved and no version is bumped.
 */
@Injectable()
export class ApproveKnowledgeEntry {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and approves in its own transaction.
   * @param command the entry, the reviewed revision, the checklist and the version the caller loaded.
   * @returns the domain's result as is.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {ItemNotFound} when no entry has the id.
   * @throws {RevisionNotLatest}, {ChecklistIncomplete}, {LocaleIncomplete} or {InvalidTransition}
   * from the domain; nothing is stored.
   * @throws {ConcurrentModification} when the entry is no longer at `expectedVersion`.
   */
  async execute(command: ApproveKnowledgeEntryCommand): Promise<ApproveResult> {
    const parsed = approveKnowledgeEntryCommand.parse(command);
    return this.uow.run((scope) => this.executeIn(scope, parsed));
  }

  /**
   * Approves inside a unit of work the caller runs; the caller has validated the command.
   * @param scope the caller's unit of work scope.
   * @param command the validated command.
   * @returns the domain's result.
   */
  async executeIn(
    scope: ContentScope,
    command: ApproveKnowledgeEntryCommand,
  ): Promise<ApproveResult> {
    const entry = await loadKnowledgeEntry(scope, command.id);
    const result = entry.approve(command.revisionId, command.checklist, this.clock.now());
    if (!result.alreadyApproved) await scope.knowledgeEntries.save(entry, command.expectedVersion);
    return result;
  }
}
