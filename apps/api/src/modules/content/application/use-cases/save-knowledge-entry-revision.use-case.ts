import { Injectable } from "@nestjs/common";
import { Clock } from "../clock.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import { IdGenerator } from "../id-generator.js";
import {
  loadKnowledgeEntry,
  type SaveKnowledgeEntryRevisionCommand,
  saveKnowledgeEntryRevisionCommand,
} from "./knowledge-entry-commands.js";

/** What a save stored: the new revision and the entry's new version. */
export interface SavedKnowledgeEntryRevision {
  readonly id: string;
  readonly revisionId: string;
  readonly number: number;
  readonly version: number;
}

/**
 * Saves a new revision of an entry with its private provenance; the entry goes back to `draft` and
 * an approved revision stays live until the new one is approved (D4).
 */
@Injectable()
export class SaveKnowledgeEntryRevision {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and saves the revision in one transaction.
   * @param command the entry, its full document, its provenance and the version the caller loaded.
   * @returns the new revision and the entry's new version.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {ItemNotFound} when no entry has the id.
   * @throws {FieldFormatInvalid} or {InvalidTransition} from the domain; nothing is stored.
   * @throws {ConcurrentModification} when the entry is no longer at `expectedVersion`.
   */
  async execute(command: SaveKnowledgeEntryRevisionCommand): Promise<SavedKnowledgeEntryRevision> {
    const parsed = saveKnowledgeEntryRevisionCommand.parse(command);
    return this.uow.run(async (scope) => {
      const entry = await loadKnowledgeEntry(scope, parsed.id);
      const revision = entry.saveRevision(
        parsed.document,
        parsed.provenance,
        "owner",
        this.ids.next(),
        this.clock.now(),
      );
      await scope.knowledgeEntries.save(entry, parsed.expectedVersion);
      return {
        id: entry.id,
        revisionId: revision.id,
        number: revision.number,
        version: parsed.expectedVersion + 1,
      };
    });
  }
}
