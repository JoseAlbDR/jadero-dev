import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ItemNotFound } from "../../domain/content.errors.js";
import { LOCALES, type Locale } from "../../domain/locale.js";
import type { PublishResult } from "../../domain/localized-revisions.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import { localeSchema } from "../content-documents.js";
import { PublishContentItem } from "./publish-content-item.use-case.js";

/** Publishes the journal post of one work package, in the named locales or every pending one. */
export interface PublishJournalPostCommand {
  readonly wp: number;
  /** The locales to publish; omitted, every locale whose latest revision is not live yet. */
  readonly locales?: readonly Locale[] | undefined;
}

const publishJournalPostCommand: z.ZodType<PublishJournalPostCommand> = z.object({
  wp: z.int().min(1),
  locales: z.array(localeSchema).min(1).optional(),
});

/**
 * Publishes a journal post on the owner's command (WP-39 D3, ADR-034: the import never publishes),
 * until the admin (WP-17) offers the same action. It finds the post by work package and hands the
 * locales to `PublishContentItem`, so every publish guard of the domain applies: each locale complete,
 * es and en live afterwards (D-20), de left out a warning.
 */
@Injectable()
export class PublishJournalPost {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly publish: PublishContentItem,
  ) {}

  /**
   * Validates the command and publishes in one unit of work.
   * @param command the work package and, optionally, the locales.
   * @returns the domain's result: the locales that went live, the no-ops, the warnings; all empty
   * when no locale was named and none had a pending draft.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {ItemNotFound} when the work package has no journal post.
   * @throws {LocaleIncomplete}, {RequiredLocalesMissing} or {InvalidTransition} from the domain;
   * nothing is stored.
   */
  async execute(command: PublishJournalPostCommand): Promise<PublishResult> {
    const { wp, locales } = publishJournalPostCommand.parse(command);
    return this.uow.run(async (scope) => {
      const post = await scope.posts.findJournal(wp);
      if (post === undefined) throw new ItemNotFound("journal post of WP", String(wp));
      const targets =
        locales ??
        LOCALES.filter((locale) => {
          const state = post.translations.stateOf(locale);
          return state === "draft" || state === "changed";
        });
      if (targets.length === 0) {
        return { itemId: post.id, published: [], alreadyPublished: [], warnings: [] };
      }
      return this.publish.executeIn(scope, {
        type: "post",
        id: post.id,
        locales: targets,
        expectedVersion: post.version,
      });
    });
  }
}
