import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Locale } from "../../domain/locale.js";
import type { PostDocument } from "../../domain/post.js";
import { ContentUnitOfWork } from "../content.unit-of-work.js";
import { localeSchema, postDocumentSchema } from "../content-documents.js";
import { CreateContentItem } from "./create-content-item.use-case.js";
import { SaveContentRevision } from "./save-content-revision.use-case.js";

/** One journal draft to import: its work package, its locale and the post document it becomes. */
export interface ImportJournalPostCommand {
  readonly wp: number;
  readonly locale: Locale;
  readonly document: PostDocument;
}

/**
 * What an import did in the draft's locale: `created` its first revision (and the journal post when
 * the WP had none), `revised` it with a new draft revision, or left it `unchanged` because the latest
 * revision already holds the same document.
 */
export type JournalImportOutcome = "created" | "revised" | "unchanged";

const importJournalPostCommand: z.ZodType<ImportJournalPostCommand> = z.object({
  wp: z.int().min(1),
  locale: localeSchema,
  document: postDocumentSchema,
});

/**
 * The canonical slug of the journal post of one work package: stable, for admin routes and events,
 * and unique because a WP has one journal post (WP-39 D1). The seed's WP-12 post uses the same form.
 * @param wp the work package number.
 * @returns `journal-wp-<wp>`.
 */
export function journalSlug(wp: number): string {
  return `journal-wp-${wp}`;
}

/**
 * Tells whether two post documents hold the same content, field by field, so a second import of an
 * unchanged draft saves nothing (idempotent import).
 * @param a one document.
 * @param b the other.
 * @returns true when every field and every tag, in order, is equal.
 */
export function samePostDocument(a: PostDocument, b: PostDocument): boolean {
  return (
    a.slug === b.slug &&
    a.title === b.title &&
    a.excerpt === b.excerpt &&
    a.body === b.body &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

/**
 * Imports one journal draft (WP-39 D3, ADR-034) by upserting on its work package: it creates the
 * journal post when the WP has none, and appends a draft revision in the draft's locale only when the
 * document differs from that locale's latest revision. It never publishes: a draft goes live only on
 * the owner's command (human in the loop). Create and revision share one transaction, so a failure
 * leaves no journal post without its revision.
 */
@Injectable()
export class ImportJournalPost {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly createItem: CreateContentItem,
    private readonly saveRevision: SaveContentRevision,
  ) {}

  /**
   * Validates the command and imports the draft in one unit of work.
   * @param command the work package, the locale and the post document.
   * @returns what happened in that locale: created, revised or unchanged.
   * @throws {ZodError} when the command breaks its schema; nothing runs.
   * @throws {FieldFormatInvalid} or {InvalidTransition} from the domain (a malformed slug or tag, an
   * archived post); nothing is stored.
   * @throws {ConcurrentModification} when another write changed the post meanwhile.
   */
  async execute(command: ImportJournalPostCommand): Promise<JournalImportOutcome> {
    const { wp, locale, document } = importJournalPostCommand.parse(command);
    return this.uow.run(async (scope) => {
      const post = await scope.posts.findJournal(wp);
      if (post === undefined) {
        const { id, version } = await this.createItem.executeIn(scope, {
          type: "post",
          slug: journalSlug(wp),
          kind: "journal",
          wp,
        });
        await this.saveRevision.executeIn(scope, {
          type: "post",
          id,
          locale,
          document,
          expectedVersion: version,
        });
        return "created";
      }
      const latest = post.translations.latest(locale);
      if (latest !== null && samePostDocument(latest.document, document)) return "unchanged";
      await this.saveRevision.executeIn(scope, {
        type: "post",
        id: post.id,
        locale,
        document,
        expectedVersion: post.version,
      });
      return latest === null ? "created" : "revised";
    });
  }
}
