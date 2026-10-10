import { Injectable } from "@nestjs/common";
import { Clock } from "../clock.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type ChangedKnowledgeEntry,
  type KnowledgeEntryTransitionCommand,
  transitionKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/**
 * Deletes an entry: a withdraw plus a terminal tombstone (D-65). The row stays, so the id is never
 * reused; every later transition is refused.
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
    return transitionKnowledgeEntry(this.uow, command, (entry) => entry.delete(this.clock.now()));
  }
}
