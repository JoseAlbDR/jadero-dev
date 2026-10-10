import { Injectable } from "@nestjs/common";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import { IdGenerator } from "../id-generator.js";
import {
  type CreateContentItemCommand,
  type CreateContentItemCommandOf,
  createContentItemCommand,
} from "./content-commands.js";
import { LOCALIZED, type LocalizedType } from "./localized-types.js";

/** What a create stored: the item's type, its id and its first version. */
export interface CreatedContentItem {
  readonly type: LocalizedType;
  readonly id: string;
  readonly version: number;
}

/**
 * Creates a profile, experience item, project, post, skill or CV bullet with no revision (D1): its
 * layout only, every locale `missing`. One class for every localized type (owner decision,
 * granularity B): the command's `type` picks the entry of `LOCALIZED`, which builds the aggregate
 * and binds its repository. The profile is a singleton: a create when one exists is a conflict.
 */
@Injectable()
export class CreateContentItem {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Validates the command and creates the item in its own transaction.
   * @param command the type and its layout fields; an omitted id is a new UUIDv7.
   * @returns the stored item's type, id and version (1).
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {SlugInvalid} or {IdInvalid} from the domain; nothing is stored.
   * @throws {ConcurrentModification} when the id is taken, or a profile already exists.
   */
  async execute(command: CreateContentItemCommand): Promise<CreatedContentItem> {
    const parsed = createContentItemCommand.parse(command);
    return this.uow.run((scope) => this.executeIn(scope, parsed));
  }

  /**
   * Creates the item inside a unit of work the caller runs, so several steps share one
   * transaction (the seed creates, saves and publishes an item in one run). The caller has
   * validated the command.
   * @param scope the caller's unit of work scope.
   * @param command the validated command.
   * @returns the stored item's type, id and version.
   */
  async executeIn<K extends LocalizedType>(
    scope: ContentScope,
    command: CreateContentItemCommandOf<K>,
  ): Promise<CreatedContentItem> {
    const created = LOCALIZED[command.type].create(scope, command, this.ids);
    await created.save(0);
    return { type: command.type, id: created.item.id, version: 1 };
  }
}
