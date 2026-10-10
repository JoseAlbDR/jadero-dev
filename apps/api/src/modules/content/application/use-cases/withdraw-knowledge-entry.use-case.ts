import { Injectable } from "@nestjs/common";
import { Clock } from "../clock.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type ChangedKnowledgeEntry,
  type KnowledgeEntryTransitionCommand,
  transitionKnowledgeEntry,
} from "./knowledge-entry-commands.js";

/**
 * Withdraws an entry: the approved pointer is cleared at once, so its page and its place in the
 * agent's index go (D4); a new revision and an approval bring it back.
 */
@Injectable()
export class WithdrawKnowledgeEntry {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Withdraws the entry in one transaction.
   * @param command the entry and the version the caller loaded.
   * @returns the entry and its new version.
   * @throws {ItemNotFound}, {InvalidTransition} (already withdrawn, or deleted) or
   * {ConcurrentModification}; see `transitionKnowledgeEntry`.
   */
  async execute(command: KnowledgeEntryTransitionCommand): Promise<ChangedKnowledgeEntry> {
    return transitionKnowledgeEntry(this.uow, command, (entry) => entry.withdraw(this.clock.now()));
  }
}
