import { Injectable } from "@nestjs/common";
import type { Locale } from "../../domain/locale.js";
import { Clock } from "../clock.js";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import { IdGenerator } from "../id-generator.js";
import {
  type SaveContentRevisionCommand,
  type SaveContentRevisionCommandOf,
  saveContentRevisionCommand,
} from "./content-commands.js";
import { type LocalizedType, loadLocalized } from "./localized-types.js";

/** What a save stored: the new revision and the item's new version. */
export interface SavedContentRevision {
  readonly id: string;
  readonly locale: Locale;
  readonly revisionId: string;
  /** The revision's number within its locale: 1, 2, 3 ... */
  readonly number: number;
  readonly version: number;
}

/**
 * Saves a new revision of one locale of any localized item (ADR-011: every save creates a revision;
 * Trace 1 steps 2 and 3). The published revision stays live until the next publish. Origin is
 * `owner` (Q3; `machine` arrives with WP-32).
 */
@Injectable()
export class SaveContentRevision {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and saves the revision in its own transaction.
   * @param command the item, the locale, its full document and the version the caller loaded.
   * @returns the new revision and the item's new version.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {ItemNotFound} when no item of that type has the id.
   * @throws {FieldFormatInvalid} or {InvalidTransition} from the domain; nothing is stored.
   * @throws {ConcurrentModification} when the item is no longer at `expectedVersion`; nothing is
   * stored (D5, Trace 2b).
   */
  async execute(command: SaveContentRevisionCommand): Promise<SavedContentRevision> {
    const parsed = saveContentRevisionCommand.parse(command);
    return this.uow.run((scope) => this.executeIn(scope, parsed));
  }

  /**
   * Saves the revision inside a unit of work the caller runs; the caller has validated the command.
   * @param scope the caller's unit of work scope.
   * @param command the validated command.
   * @returns the new revision and the item's new version.
   */
  async executeIn<K extends LocalizedType>(
    scope: ContentScope,
    command: SaveContentRevisionCommandOf<K>,
  ): Promise<SavedContentRevision> {
    const { item, save } = await loadLocalized(scope, command.type, command.id);
    const revision = item.saveRevision(
      command.locale,
      command.document,
      "owner",
      this.ids.next(),
      this.clock.now(),
    );
    await save(command.expectedVersion);
    return {
      id: item.id,
      locale: revision.locale,
      revisionId: revision.id,
      number: revision.number,
      version: command.expectedVersion + 1,
    };
  }
}
