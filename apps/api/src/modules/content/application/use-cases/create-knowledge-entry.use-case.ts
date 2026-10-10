import { Injectable } from "@nestjs/common";
import { KnowledgeEntry } from "../../domain/knowledge-entry.js";
import { Clock } from "../clock.js";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import { IdGenerator } from "../id-generator.js";
import {
  type CreateKnowledgeEntryCommand,
  createKnowledgeEntryCommand,
} from "./knowledge-entry-commands.js";

/** What a create stored: the entry, its first revision and its first version. */
export interface CreatedKnowledgeEntry {
  readonly id: string;
  readonly revisionId: string;
  readonly version: number;
}

/**
 * Creates a knowledge entry with its first revision, in `draft` (D4). Origin is `owner` (Q3).
 */
@Injectable()
export class CreateKnowledgeEntry {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and creates the entry in its own transaction.
   * @param command the human id, the first document and its private provenance.
   * @returns the entry, its first revision and its version (1).
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {IdInvalid} or {FieldFormatInvalid} from the domain; nothing is stored.
   * @throws {ConcurrentModification} when the id is taken.
   */
  async execute(command: CreateKnowledgeEntryCommand): Promise<CreatedKnowledgeEntry> {
    const parsed = createKnowledgeEntryCommand.parse(command);
    return this.uow.run((scope) => this.executeIn(scope, parsed));
  }

  /**
   * Creates the entry inside a unit of work the caller runs; the caller has validated the command.
   * @param scope the caller's unit of work scope.
   * @param command the validated command.
   * @returns the entry, its first revision and its version.
   */
  async executeIn(
    scope: ContentScope,
    command: CreateKnowledgeEntryCommand,
  ): Promise<CreatedKnowledgeEntry> {
    const entry = KnowledgeEntry.create({
      id: command.id,
      document: command.document,
      provenance: command.provenance,
      origin: "owner",
      revisionId: this.ids.next(),
      at: this.clock.now(),
    });
    await scope.knowledgeEntries.save(entry, 0);
    return { id: entry.id, revisionId: entry.latest().id, version: 1 };
  }
}
