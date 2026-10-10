import { Injectable } from "@nestjs/common";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type ChangedKnowledgeEntry,
  type KnowledgeEntryTransitionCommand,
  transitionKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/** Sends an entry in review back to the writer: `in_review` to `draft` (D4). */
@Injectable()
export class RequestKnowledgeEntryChanges {
  constructor(private readonly uow: ContentUnitOfWork) {}

  /**
   * Requests changes in one transaction.
   * @param command the entry and the version the caller loaded.
   * @returns the entry and its new version.
   * @throws {ItemNotFound}, {InvalidTransition} (not in `in_review`) or {ConcurrentModification};
   * see `transitionKnowledgeEntry`.
   */
  async execute(command: KnowledgeEntryTransitionCommand): Promise<ChangedKnowledgeEntry> {
    return transitionKnowledgeEntry(this.uow, command, (entry) => entry.requestChanges());
  }
}
