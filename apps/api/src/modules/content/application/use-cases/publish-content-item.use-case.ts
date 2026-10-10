import { Injectable } from "@nestjs/common";
import type { PublishResult } from "../../domain/localized-revisions.js";
import { Clock } from "../clock.js";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  type PublishContentItemCommand,
  type PublishContentItemCommandOf,
  publishContentItemCommand,
} from "./content-commands.js";
import { type LocalizedType, loadLocalized } from "./localized-types.js";

/**
 * Publishes the latest revision of the named locales of any localized item (D4, Trace 1 steps 6
 * and 7): each named locale complete, es and en published afterwards (D-20), de left out a warning.
 * A publish that moves no pointer (every locale already live) saves nothing and bumps no version.
 * Publishing an older revision (the rollback of D2) needs a load of that revision by id, which no
 * repository offers yet.
 */
@Injectable()
export class PublishContentItem {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Validates the command and publishes in its own transaction.
   * @param command the item, the locales and the version the caller loaded.
   * @returns the domain's result as is: the locales that moved, the no-ops, the warnings.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {ItemNotFound} when no item of that type has the id.
   * @throws {LocaleIncomplete}, {RequiredLocalesMissing} or {InvalidTransition} from the domain;
   * nothing is stored.
   * @throws {ConcurrentModification} when the item is no longer at `expectedVersion`.
   */
  async execute(command: PublishContentItemCommand): Promise<PublishResult> {
    const parsed = publishContentItemCommand.parse(command);
    return this.uow.run((scope) => this.executeIn(scope, parsed));
  }

  /**
   * Publishes inside a unit of work the caller runs; the caller has validated the command.
   * @param scope the caller's unit of work scope.
   * @param command the validated command.
   * @returns the domain's publish result.
   */
  async executeIn<K extends LocalizedType>(
    scope: ContentScope,
    command: PublishContentItemCommandOf<K>,
  ): Promise<PublishResult> {
    const { item, save } = await loadLocalized(scope, command.type, command.id);
    const result = item.publish(command.locales, this.clock.now());
    // An empty change set: nothing moved, so there is nothing to store (and, in WP-14, no event).
    if (result.published.length > 0) await save(command.expectedVersion);
    return result;
  }
}
