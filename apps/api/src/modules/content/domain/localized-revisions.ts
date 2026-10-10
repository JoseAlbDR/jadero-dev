import {
  FieldFormatInvalid,
  InvalidTransition,
  LocaleIncomplete,
  RequiredLocalesMissing,
  RevisionNotOfItem,
} from "./content.errors.js";
import { LOCALES, type Locale, OPTIONAL_LOCALES, REQUIRED_LOCALES } from "./locale.js";
import type { Revision, RevisionOrigin } from "./revision.js";
import { RevisionHistory } from "./revision-history.js";

/**
 * The publish state of one locale, derived from the pointers (D4), never stored: `missing` (no
 * revision), `draft` (revisions, none published), `published` (the published revision is the
 * latest), `changed` (the published one is older than the latest; visitors see the published one).
 */
export type LocaleState = "missing" | "draft" | "published" | "changed";

/**
 * The two checks an item type supplies for its documents. Format is checked on every save, so a
 * malformed value is never stored; completeness only on publish, so a draft may be partial.
 */
export interface DocumentRules<TDoc extends object> {
  /**
   * The fields that hold a value in the wrong format (`slug`, `stackTags[1]`). An empty text is
   * absent, not malformed: drafts may leave fields empty.
   * @param document one locale's content.
   * @returns the field paths, empty when the document can be saved.
   */
  invalidFields(document: TDoc): readonly string[];
  /**
   * Whether every field the public contract requires for a page of this type is filled, so the
   * revision can be published.
   * @param document one locale's content.
   * @returns true when the document is complete.
   */
  isComplete(document: TDoc): boolean;
}

/** One locale as stored: its latest revision and, once published, the published one and when. */
export interface LocaleSnapshot<TDoc extends object> {
  readonly latest: Revision<TDoc>;
  readonly published: Revision<TDoc> | null;
  /** When the published pointer last moved (a publish or a rollback). */
  readonly publishedAt: Date | null;
  /** When the locale was first published; never changed afterwards. */
  readonly firstPublishedAt: Date | null;
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

/**
 * What a publish changed; WP-14 turns `published` into outbox rows in the same unit of work. An
 * empty `published` is an empty change set: nothing moved, so the use case has nothing to save and
 * no version to bump.
 */
export interface PublishResult {
  readonly itemId: string;
  /** The locales whose pointer moved, with the revision it points at now. */
  readonly published: readonly { readonly locale: Locale; readonly revisionId: string }[];
  /** The named locales whose target revision was already the published one: no-ops. */
  readonly alreadyPublished: readonly Locale[];
  readonly warnings: readonly PublishWarning[];
}

/** The read side of the state machine, which an aggregate exposes; writes go through the aggregate. */
export type LocalizedRevisionsView<TDoc extends object> = Pick<
  LocalizedRevisions<TDoc>,
  | "stateOf"
  | "latest"
  | "published"
  | "publishedAt"
  | "firstPublishedAt"
  | "isComplete"
  | "archivedAt"
>;

/** One locale in memory: its revision history and the published pointer into it. */
interface Slot<TDoc extends object> {
  readonly history: RevisionHistory<TDoc>;
  readonly published: Revision<TDoc> | null;
  readonly publishedAt: Date | null;
  readonly firstPublishedAt: Date | null;
}

/**
 * The per-locale publish state machine of one content item (D4), shared by composition: every
 * aggregate holds one and supplies its document type and rules. It keeps per locale a
 * `RevisionHistory` holding the latest and the published revision, not the whole history (D1),
 * appends revisions whose fields are well formed, and
 * guards publish: each named locale has a complete revision of this item; afterwards es and en are
 * both published; de left out is a warning. Archiving only hides: it changes no revision or pointer.
 */
export class LocalizedRevisions<TDoc extends object> {
  private constructor(
    private readonly itemId: string,
    private readonly rules: DocumentRules<TDoc>,
    private readonly slots: Map<Locale, Slot<TDoc>>,
    private archivedOn: Date | null,
  ) {}

  /**
   * The machine of a new item: every locale `missing`, not archived.
   * @param itemId the item's identity, which every revision must carry.
   * @param rules the item type's format and completeness rules.
   */
  static empty<TDoc extends object>(
    itemId: string,
    rules: DocumentRules<TDoc>,
  ): LocalizedRevisions<TDoc> {
    return new LocalizedRevisions(itemId, rules, new Map(), null);
  }

  /**
   * Rebuilds the machine from stored pointers. Nothing is re-checked: the database's foreign keys
   * prove each pointer names a revision of the same item and locale.
   * @param itemId the item's identity.
   * @param rules the item type's format and completeness rules.
   * @param snapshot the locales that have revisions, and the archive mark.
   */
  static reconstitute<TDoc extends object>(
    itemId: string,
    rules: DocumentRules<TDoc>,
    snapshot: LocalizedRevisionsSnapshot<TDoc>,
  ): LocalizedRevisions<TDoc> {
    const slots = new Map<Locale, Slot<TDoc>>();
    for (const locale of LOCALES) {
      const stored = snapshot.locales[locale];
      if (stored) {
        const revisions =
          stored.published && stored.published.id !== stored.latest.id
            ? [stored.published, stored.latest]
            : [stored.latest];
        slots.set(locale, {
          history: RevisionHistory.reconstitute(itemId, locale, { revisions }),
          published: stored.published,
          publishedAt: copy(stored.publishedAt),
          firstPublishedAt: copy(stored.firstPublishedAt),
        });
      }
    }
    return new LocalizedRevisions(itemId, rules, slots, copy(snapshot.archivedAt));
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
    return slot.published.id === slot.history.latest()?.id ? "published" : "changed";
  }

  /**
   * The newest revision of a locale, published or not.
   * @param locale the locale.
   * @returns the revision, or null when the locale is `missing`.
   */
  latest(locale: Locale): Revision<TDoc> | null {
    return this.slots.get(locale)?.history.latest() ?? null;
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
   * When the published pointer of a locale last moved, by a publish or a rollback.
   * @param locale the locale.
   * @returns the time, or null when the locale was never published.
   */
  publishedAt(locale: Locale): Date | null {
    return copy(this.slots.get(locale)?.publishedAt ?? null);
  }

  /**
   * When a locale was first published: set once, never moved by later publishes or rollbacks, so
   * a post's place in its feed does not change when a typo is fixed.
   * @param locale the locale.
   * @returns the time, or null when the locale was never published.
   */
  firstPublishedAt(locale: Locale): Date | null {
    return copy(this.slots.get(locale)?.firstPublishedAt ?? null);
  }

  /**
   * Whether the latest revision of a locale could be published: the completeness the admin shows
   * per locale (ADR-011).
   * @param locale the locale.
   * @returns false for a `missing` locale or a latest revision with required fields empty.
   */
  isComplete(locale: Locale): boolean {
    const latest = this.latest(locale);
    return latest !== null && this.rules.isComplete(latest.document);
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
   * Fields that hold a value must be well formed; empty ones are allowed (a draft), and
   * completeness is checked at publish. Moves the locale `missing` to `draft`, `draft` to `draft`,
   * `published` to `changed`, `changed` to `changed`.
   * @param locale the locale written.
   * @param document one locale's full item.
   * @param origin who wrote it (Q3 A).
   * @param revisionId the new revision's identity, chosen by the use case.
   * @param at the save time, from the use case's clock.
   * @returns the new revision.
   * @throws {InvalidTransition} when the item is archived.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  append(
    locale: Locale,
    document: TDoc,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<TDoc> {
    this.assertActive("save a revision of");
    const invalid = this.rules.invalidFields(document);
    if (invalid.length > 0) throw new FieldFormatInvalid(this.itemId, locale, invalid);

    const slot = this.slots.get(locale) ?? {
      history: RevisionHistory.empty<TDoc>(this.itemId, locale),
      published: null,
      publishedAt: null,
      firstPublishedAt: null,
    };
    const revision = slot.history.append(document, null, origin, revisionId, at);
    this.slots.set(locale, slot);
    return revision;
  }

  /**
   * Moves the published pointer of each named locale, all or nothing. Guards, in order: the item is
   * not archived; each locale is named once; a given revision belongs to this item and locale; the
   * revision to publish exists and is complete; afterwards es and en are both published. A locale
   * whose target is already its published revision is a no-op, listed in `alreadyPublished`; an
   * optional locale left unpublished is a warning, not an error.
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time, from the use case's clock.
   * @returns the locales that moved, the no-ops, and the warnings.
   * @throws {InvalidTransition} when archived or a locale is named twice.
   * @throws {RevisionNotOfItem} when a given revision is not one of this item and locale.
   * @throws {LocaleIncomplete} when a locale has no revision or the chosen one is incomplete.
   * @throws {RequiredLocalesMissing} when es or en would still be unpublished.
   */
  publish(targets: readonly PublishTarget<TDoc>[], at: Date): PublishResult {
    this.assertActive("publish");

    const named = new Set<Locale>();
    const moves = new Map<Locale, Revision<TDoc>>();
    const alreadyPublished: Locale[] = [];
    for (const target of targets) {
      const locale = typeof target === "string" ? target : target.locale;
      if (named.has(locale)) {
        throw new InvalidTransition(this.itemId, "publish", `${locale} is named twice`);
      }
      named.add(locale);
      const revision =
        typeof target === "string" ? this.latest(locale) : this.known(locale, target.revision);
      if (!revision || !this.rules.isComplete(revision.document)) {
        throw new LocaleIncomplete(this.itemId, locale);
      }
      if (this.published(locale)?.id === revision.id) alreadyPublished.push(locale);
      else moves.set(locale, revision);
    }

    const unpublishedAfter = (locale: Locale) => !moves.has(locale) && !this.published(locale);
    const missing = REQUIRED_LOCALES.filter(unpublishedAfter);
    if (missing.length > 0) throw new RequiredLocalesMissing(this.itemId, missing);

    for (const [locale, revision] of moves) {
      const slot = this.slots.get(locale) as Slot<TDoc>;
      this.slots.set(locale, {
        ...slot,
        published: revision,
        publishedAt: copy(at),
        firstPublishedAt: slot.firstPublishedAt ?? copy(at),
      });
    }
    return {
      itemId: this.itemId,
      published: [...moves].map(([locale, revision]) => ({ locale, revisionId: revision.id })),
      alreadyPublished,
      warnings: OPTIONAL_LOCALES.filter(unpublishedAfter).map((locale) => ({
        code: "optional-locale-unpublished",
        locale,
      })),
    };
  }

  /**
   * Archives the item: every locale is hidden at once (no per-locale unpublish, which could break
   * D-20). It only sets the archive mark: every revision and pointer stays as it was, so a later
   * restore is a transition with no data to rebuild. An archived item accepts no other change.
   * @param at the archive time, from the use case's clock.
   * @throws {InvalidTransition} when the item is already archived.
   */
  archive(at: Date): void {
    this.assertActive("archive");
    this.archivedOn = copy(at);
  }

  /**
   * The revisions appended since the machine was created or loaded, which a repository inserts in
   * the same transaction as the pointers. After the save the aggregate is discarded and the next use
   * case loads it again, so there is no "mark saved".
   * @returns per locale in the order es, en, de, each locale's revisions in number order.
   */
  unsavedRevisions(): readonly Revision<TDoc>[] {
    return LOCALES.flatMap((locale) => this.slots.get(locale)?.history.unsavedRevisions() ?? []);
  }

  /**
   * What a repository stores: the exact mirror of `reconstitute`'s input, so
   * `reconstitute(itemId, rules, machine.snapshot())` rebuilds an equal machine. Revisions appended
   * in between that are neither latest nor published are not in it: `unsavedRevisions` lists them.
   * @returns per locale with revisions its latest and published revision and their times, and the
   * archive mark; dates are copies.
   */
  snapshot(): LocalizedRevisionsSnapshot<TDoc> {
    const locales: Partial<Record<Locale, LocaleSnapshot<TDoc>>> = {};
    for (const [locale, slot] of this.slots) {
      const latest = slot.history.latest();
      if (latest) {
        locales[locale] = {
          latest,
          published: slot.published,
          publishedAt: copy(slot.publishedAt),
          firstPublishedAt: copy(slot.firstPublishedAt),
        };
      }
    }
    return { locales, archivedAt: copy(this.archivedOn) };
  }

  /** The given revision, when it is one this aggregate can know: same item, same locale, not newer. */
  private known(locale: Locale, revision: Revision<TDoc>): Revision<TDoc> {
    if (!this.slots.get(locale)?.history.belongs(revision)) {
      throw new RevisionNotOfItem(this.itemId, locale, revision.id);
    }
    return revision;
  }

  private assertActive(action: string): void {
    if (this.archivedOn) throw new InvalidTransition(this.itemId, action, "the item is archived");
  }
}

function copy(date: Date | null): Date | null {
  return date ? new Date(date.getTime()) : null;
}
