import type {
  ExperienceListDto,
  KnowledgeEntryDto,
  KnowledgeEntryListDto,
  Locale,
  PostCursorPosition,
  PostDto,
  PostPageDto,
  ProfileDto,
  ProjectDto,
  ProjectKind,
  ProjectListDto,
  SkillListDto,
} from "@jadero/contracts";

/** How many posts one page of the feed holds (keyset pagination, WP-12 implementation choices). */
export const POSTS_PAGE_SIZE = 20;

/**
 * The read side of the content module (CQRS, deferred from WP-10 D5 to WP-12): what a visitor may
 * see, straight from the published pointers, as the public contract DTOs of `packages/contracts`.
 * It never loads an aggregate or goes through a repository, and it never returns a draft, an
 * archived item, an unapproved or deleted entry, or an entry's private provenance (D-67).
 *
 * German fallback (owner-approved implementation choice): only `de` falls back, because `es` and
 * `en` are required at publish (D-20). An item not published in German answers in English with
 * `locale: "en"`; in a list each item falls back on its own.
 */
export abstract class ContentQueries {
  /**
   * @param locale the requested locale.
   * @returns the published profile, or undefined when there is none.
   */
  abstract profile(locale: Locale): Promise<ProfileDto | undefined>;

  /**
   * @param locale the requested locale.
   * @returns every published experience item in display order, each with its published CV bullets
   * in the item's own language and the ids of the approved entries under each bullet.
   */
  abstract experience(locale: Locale): Promise<ExperienceListDto>;

  /**
   * @param locale the requested locale.
   * @param kind only projects of this kind, or all of them.
   * @returns the published projects in display order.
   */
  abstract projects(locale: Locale, kind?: ProjectKind): Promise<ProjectListDto>;

  /**
   * @param locale the requested locale.
   * @param slug a published localized slug: German first, then English when the project has no
   * published German version.
   * @returns the published project, or undefined when no project answers to that slug.
   */
  abstract project(locale: Locale, slug: string): Promise<ProjectDto | undefined>;

  /**
   * @param locale the requested locale.
   * @param after the position of the last post of the previous page, or undefined for the first.
   * @returns up to {@link POSTS_PAGE_SIZE} posts, newest first publication first, and the cursor of
   * the next page.
   */
  abstract posts(locale: Locale, after?: PostCursorPosition): Promise<PostPageDto>;

  /**
   * @param locale the requested locale.
   * @param slug a published localized slug, with the same German fallback as {@link project}.
   * @returns the published post, or undefined.
   */
  abstract post(locale: Locale, slug: string): Promise<PostDto | undefined>;

  /**
   * @param locale the requested locale.
   * @returns every published skill in display order.
   */
  abstract skills(locale: Locale): Promise<SkillListDto>;

  /** @returns every approved, not deleted knowledge entry (English only), by id. */
  abstract workLog(): Promise<KnowledgeEntryListDto>;

  /**
   * @param entryId the entry's human id (`kb-...`).
   * @returns the approved revision of the entry, or undefined when it is not approved or deleted.
   */
  abstract workEntry(entryId: string): Promise<KnowledgeEntryDto | undefined>;
}
