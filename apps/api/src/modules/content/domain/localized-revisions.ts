import {
  InvalidTransition,
  LocaleIncomplete,
  RequiredLocalesMissing,
  RevisionNotOfItem,
} from "./content.errors.js";
import { LOCALES, type Locale, OPTIONAL_LOCALES, REQUIRED_LOCALES } from "./locale.js";
import { Revision, type RevisionOrigin } from "./revision.js";

/**
 * The publish state of one locale, derived from the pointers (D4), never stored: `missing` (no
 * revision), `draft` (revisions, none published), `published` (the published revision is the
 * latest), `changed` (the published one is older than the latest; visitors see the published one).
 */
export type LocaleState = "missing" | "draft" | "published" | "changed";

/** Tells whether a document has every field a public page needs; each aggregate supplies its own. */
export type Completeness<TDoc extends object> = (document: TDoc) => boolean;

/** One locale as stored: its latest revision and, once published, the published one and when. */
export interface LocaleSnapshot<TDoc extends object> {
  readonly latest: Revision<TDoc>;
  readonly published: Revision<TDoc> | null;
  readonly publishedAt: Date | null;
}

/** What a repository reads back for an item: the locales that have revisions, and the archive mark. */
export interface LocalizedRevisionsSnapshot<TDoc extends object> {
  readonly locales: Partial<Record<Locale, LocaleSnapshot<TDoc>>>;
  readonly archivedAt: Date | null;
}

/**
 * One locale to publish: a locale alone publishes its latest revision; a locale with a revision
 * publishes that one, which may be older (the rollback of D2; the use case loads it by id).
 */
export type PublishTarget<TDoc extends object> =
  | Locale
  | { readonly locale: Locale; readonly revision: Revision<TDoc> };

/** A publish left an optional locale (de) unpublished: allowed, reported (D-20). */
export interface PublishWarning {
  readonly code: "optional-locale-unpublished";
  readonly locale: Locale;
}

/** What a publish changed; WP-14 turns it into outbox rows in the same unit of work. */
export interface PublishResult {
  readonly itemId: string;
  readonly published: readonly { readonly locale: Locale; readonly revisionId: string }[];
  readonly warnings: readonly PublishWarning[];
}

/** The read side of the state machine, which an aggregate exposes; writes go through the aggregate. */
export type LocalizedRevisionsView<TDoc extends object> = Pick<
  LocalizedRevisions<TDoc>,
  "stateOf" | "latest" | "published" | "publishedAt" | "isComplete" | "archivedAt"
>;

interface Slot<TDoc extends object> {
  readonly latest: Revision<TDoc>;
  readonly published: Revision<TDoc> | null;
  readonly publishedAt: Date | null;
}

/**
 * The per-locale publish state machine of one content item (D4), shared by composition: every
 * aggregate holds one and supplies its document type and completeness rule. It keeps per locale the
 * latest and the published revision, not the history (D1), appends revisions, and guards publish:
 * each named locale has a complete revision of this item; afterwards es and en are both published;
 * de left out is a warning. Archiving hides every locale and ends the machine.
 */
export class LocalizedRevisions<TDoc extends object> {
  private constructor(
    private readonly itemId: string,
    private readonly complete: Completeness<TDoc>,
    private readonly slots: Map<Locale, Slot<TDoc>>,
    private archivedOn: Date | null,
  ) {}

  /**
   * The machine of a new item: every locale `missing`, not archived.
   * @param itemId the item's identity, which every revision must carry.
   * @param isComplete the item type's completeness rule.
   */
  static empty<TDoc extends object>(
    itemId: string,
    isComplete: Completeness<TDoc>,
  ): LocalizedRevisions<TDoc> {
    return new LocalizedRevisions(itemId, isComplete, new Map(), null);
  }

  /**
   * Rebuilds the machine from stored pointers. Nothing is re-checked: the database's foreign keys
   * prove each pointer names a revision of the same item and locale.
   * @param itemId the item's identity.
   * @param isComplete the item type's completeness rule.
   * @param snapshot the locales that have revisions, and the archive mark.
   */
  static reconstitute<TDoc extends object>(
    itemId: string,
    isComplete: Completeness<TDoc>,
    snapshot: LocalizedRevisionsSnapshot<TDoc>,
  ): LocalizedRevisions<TDoc> {
    const slots = new Map<Locale, Slot<TDoc>>();
    for (const locale of LOCALES) {
      const stored = snapshot.locales[locale];
      if (stored) slots.set(locale, { ...stored, publishedAt: copy(stored.publishedAt) });
    }
    return new LocalizedRevisions(itemId, isComplete, slots, copy(snapshot.archivedAt));
  }

  /**
   * The derived state of one locale.
   * @param locale the locale.
   * @returns `missing`, `draft`, `published` or `changed`.
   */
  stateOf(locale: Locale): LocaleState {
    const slot = this.slots.get(locale);
    if (!slot) return "missing";
    if (!slot.published) return "draft";
    return slot.published.id === slot.latest.id ? "published" : "changed";
  }

  /**
   * The newest revision of a locale, published or not.
   * @param locale the locale.
   * @returns the revision, or null when the locale is `missing`.
   */
  latest(locale: Locale): Revision<TDoc> | null {
    return this.slots.get(locale)?.latest ?? null;
  }

  /**
   * The revision visitors see in a locale (while the item is not archived).
   * @param locale the locale.
   * @returns the revision, or null when the locale was never published.
   */
  published(locale: Locale): Revision<TDoc> | null {
    return this.slots.get(locale)?.published ?? null;
  }

  /**
   * When the published pointer of a locale last moved.
   * @param locale the locale.
   * @returns the time, or null when the locale was never published.
   */
  publishedAt(locale: Locale): Date | null {
    return copy(this.slots.get(locale)?.publishedAt ?? null);
  }

  /**
   * Whether the latest revision of a locale could be published: the completeness the admin shows
   * per locale (ADR-011).
   * @param locale the locale.
   * @returns false for a `missing` locale or a latest revision with required fields empty.
   */
  isComplete(locale: Locale): boolean {
    const latest = this.latest(locale);
    return latest !== null && this.complete(latest.document);
  }

  /**
   * When the item was archived.
   * @returns the time, or null while the item is active.
   */
  archivedAt(): Date | null {
    return copy(this.archivedOn);
  }

  /**
   * Appends a revision to a locale: numbered one above the latest, never changing an earlier one.
   * The document may be incomplete (a draft); completeness is checked at publish. Moves the locale
   * `missing` to `draft`, `draft` to `draft`, `published` to `changed`, `changed` to `changed`.
   * @param locale the locale written.
   * @param document one locale's full item.
   * @param origin who wrote it (Q3 A).
   * @param revisionId the new revision's identity, chosen by the use case.
   * @param at the save time, from the use case's clock.
   * @returns the new revision.
   * @throws {InvalidTransition} when the item is archived.
   */
  append(
    locale: Locale,
    document: TDoc,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<TDoc> {
    this.assertActive("save a revision of");
    const slot = this.slots.get(locale);
    const revision = Revision.create({
      id: revisionId,
      itemId: this.itemId,
      locale,
      number: (slot?.latest.number ?? 0) + 1,
      origin,
      document,
      createdAt: at,
    });
    this.slots.set(locale, {
      latest: revision,
      published: slot?.published ?? null,
      publishedAt: slot?.publishedAt ?? null,
    });
    return revision;
  }

  /**
   * Moves the published pointer of each named locale, all or nothing. Guards, in order: the item is
   * not archived; each locale is named once; a given revision belongs to this item and locale; the
   * revision to publish exists and is complete; it is not already the published one; afterwards es
   * and en are both published. An optional locale left unpublished is a warning, not an error.
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time, from the use case's clock.
   * @returns the locales and revisions published, and the warnings.
   * @throws {InvalidTransition} when archived, a locale is named twice or nothing would change.
   * @throws {RevisionNotOfItem} when a given revision is not one of this item and locale.
   * @throws {LocaleIncomplete} when a locale has no revision or the chosen one is incomplete.
   * @throws {RequiredLocalesMissing} when es or en would still be unpublished.
   */
  publish(targets: readonly PublishTarget<TDoc>[], at: Date): PublishResult {
    this.assertActive("publish");
    if (targets.length === 0)
      throw new InvalidTransition(this.itemId, "publish", "no locale named");

    const chosen = new Map<Locale, Revision<TDoc>>();
    for (const target of targets) {
      const locale = typeof target === "string" ? target : target.locale;
      if (chosen.has(locale)) {
        throw new InvalidTransition(this.itemId, "publish", `${locale} is named twice`);
      }
      const revision =
        typeof target === "string" ? this.latest(locale) : this.known(locale, target.revision);
      if (!revision || !this.complete(revision.document)) {
        throw new LocaleIncomplete(this.itemId, locale);
      }
      if (this.published(locale)?.id === revision.id) {
        throw new InvalidTransition(
          this.itemId,
          "publish",
          `revision ${revision.number} is already published in ${locale}`,
        );
      }
      chosen.set(locale, revision);
    }

    const unpublishedAfter = (locale: Locale) => !chosen.has(locale) && !this.published(locale);
    const missing = REQUIRED_LOCALES.filter(unpublishedAfter);
    if (missing.length > 0) throw new RequiredLocalesMissing(this.itemId, missing);

    for (const [locale, revision] of chosen) {
      const slot = this.slots.get(locale) as Slot<TDoc>;
      this.slots.set(locale, { ...slot, published: revision, publishedAt: copy(at) });
    }
    return {
      itemId: this.itemId,
      published: [...chosen].map(([locale, revision]) => ({ locale, revisionId: revision.id })),
      warnings: OPTIONAL_LOCALES.filter(unpublishedAfter).map((locale) => ({
        code: "optional-locale-unpublished",
        locale,
      })),
    };
  }

  /**
   * Archives the item: every locale is hidden at once (no per-locale unpublish, which could break
   * D-20). The pointers stay, so the history is kept; the machine accepts no further change.
   * @param at the archive time, from the use case's clock.
   * @throws {InvalidTransition} when the item is already archived.
   */
  archive(at: Date): void {
    this.assertActive("archive");
    this.archivedOn = copy(at);
  }

  /** The given revision, when it is one this aggregate can know: same item, same locale, not newer. */
  private known(locale: Locale, revision: Revision<TDoc>): Revision<TDoc> {
    const latest = this.latest(locale);
    const belongs =
      revision.itemId === this.itemId &&
      revision.locale === locale &&
      latest !== null &&
      (revision.number < latest.number || revision.id === latest.id);
    if (!belongs) throw new RevisionNotOfItem(this.itemId, locale, revision.id);
    return revision;
  }

  private assertActive(action: string): void {
    if (this.archivedOn) throw new InvalidTransition(this.itemId, action, "the item is archived");
  }
}

function copy(date: Date | null): Date | null {
  return date ? new Date(date.getTime()) : null;
}
