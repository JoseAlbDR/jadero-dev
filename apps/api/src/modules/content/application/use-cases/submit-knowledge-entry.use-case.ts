import { Injectable } from "@nestjs/common";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type ChangedKnowledgeEntry,
  type KnowledgeEntryTransitionCommand,
  transitionKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/** Sends an entry's latest revision for review: `draft` to `in_review` (D4). */
@Injectable()
export class SubmitKnowledgeEntry {
  constructor(private readonly uow: ContentUnitOfWork) {}

  /**
   * Submits the entry in one transaction.
   * @param command the entry and the version the caller loaded.
   * @returns the entry and its new version.
   * @throws {ItemNotFound}, {InvalidTransition} (not in `draft`) or {ConcurrentModification}; see
   * `transitionKnowledgeEntry`.
   */
  async execute(command: KnowledgeEntryTransitionCommand): Promise<ChangedKnowledgeEntry> {
    return transitionKnowledgeEntry(this.uow, command, (entry) => entry.submit());
  }
}
