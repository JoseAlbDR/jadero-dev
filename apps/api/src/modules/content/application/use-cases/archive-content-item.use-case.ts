import { Injectable } from "@nestjs/common";
import { InvalidTransition } from "../../domain/content.errors.js";
import { Clock } from "../clock.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import { type ArchiveContentItemCommand, archiveContentItemCommand } from "./content-commands.js";
import { loadLocalized } from "./localized-types.js";

/** What an archive stored: the item and its new version. */
export interface ArchivedContentItem {
  readonly id: string;
  readonly version: number;
}

/**
 * Archives an experience item, project, post, skill or CV bullet: every locale is hidden at once
 * and every revision and pointer is kept (no per-locale unpublish, D-20). The profile is not
 * archivable: its command schema has no member for it.
 */
@Injectable()
export class ArchiveContentItem {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and archives in its own transaction.
   * @param command the item and the version the caller loaded.
   * @returns the item and its new version.
   * @throws {ZodError} when the command breaks its schema (the profile included); nothing runs.
   * @throws {ItemNotFound} when no item of that type has the id.
   * @throws {InvalidTransition} when it is already archived; nothing is stored.
   * @throws {ConcurrentModification} when the item is no longer at `expectedVersion`.
   */
  async execute(command: ArchiveContentItemCommand): Promise<ArchivedContentItem> {
    const parsed = archiveContentItemCommand.parse(command);
    return this.uow.run(async (scope) => {
      const { item, save } = await loadLocalized(scope, parsed.type, parsed.id);
      // Unreachable through the schema, which has no profile member; kept as the domain's answer.
      if (!item.archive) throw new InvalidTransition(item.id, "archive", "it cannot be archived");
      item.archive(this.clock.now());
      await save(parsed.expectedVersion);
      return { id: item.id, version: parsed.expectedVersion + 1 };
    });
  }
}
