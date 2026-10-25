import { Injectable } from "@nestjs/common";
import { Clock } from "../clock.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import { knowledgeEntryWithdrawn } from "../content-events.js";
import {
  type ChangedKnowledgeEntry,
  type KnowledgeEntryTransitionCommand,
  transitionKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/**
 * Deletes an entry: a withdraw plus a terminal tombstone (D-65). The row stays, so the id is never
 * reused; every later transition is refused. When the entry still had an approved revision live,
 * writes one `knowledge.entry.withdrawn.v1` (reason `deleted`) in the same unit of work (WP-14 D1);
 * an entry already withdrawn or never approved had nothing public, so it writes none.
 */
@Injectable()
export class DeleteKnowledgeEntry {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Deletes the entry in one transaction.
   * @param command the entry and the version the caller loaded.
   * @returns the entry and its new version.
   * @throws {ItemNotFound}, {InvalidTransition} (already deleted) or {ConcurrentModification}; see
   * `transitionKnowledgeEntry`.
   */
  async execute(command: KnowledgeEntryTransitionCommand): Promise<ChangedKnowledgeEntry> {
    return transitionKnowledgeEntry(this.uow, command, (entry) => {
      const at = this.clock.now();
      const wasPublic = entry.approvedRevisionId !== null;
      entry.delete(at);
      return wasPublic ? knowledgeEntryWithdrawn(entry.id, "deleted", at) : undefined;
    });
  }
}
