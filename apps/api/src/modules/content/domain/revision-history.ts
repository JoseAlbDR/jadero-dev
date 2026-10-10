import type { Locale } from "./locale.js";
import { Revision, type RevisionOrigin } from "./revision.js";

/**
 * The revisions of one history a repository loaded: at least the latest, plus any other the
 * aggregate needs to hold (the published one of a locale, the approved one of an entry). Never the
 * whole history (D1): older revisions stay in their table and are loaded by id when needed.
 */
export interface RevisionHistorySnapshot<TDoc extends object, TProv extends object | null = null> {
  readonly revisions: readonly Revision<TDoc, TProv>[];
}

/**
 * The append-only history of one item in one locale (D2): revisions are numbered 1, 2, 3 ... and
 * never changed; the latest is the one with the highest number. Shared by composition: every locale
 * of a `LocalizedRevisions` holds one, and a `KnowledgeEntry` (English only) holds exactly one. It
 * knows nothing about publishing or approval: the pointers into it belong to whoever holds it.
 *
 * It also remembers which revisions were appended since it was created or loaded, so a repository
 * inserts exactly those. There is no "mark saved": an aggregate serves one unit of work, and after
 * the repository saves it the next use case loads it again (its `version` is stale by then anyway).
 */
export class RevisionHistory<TDoc extends object, TProv extends object | null = null> {
  private readonly appended: Revision<TDoc, TProv>[] = [];

  private constructor(
    private readonly itemId: string,
    private readonly locale: Locale,
    private readonly held: Map<string, Revision<TDoc, TProv>>,
    private newest: Revision<TDoc, TProv> | null,
  ) {}

  /**
   * An empty history: no revision yet.
   * @param itemId the item's identity, which every revision carries.
   * @param locale the locale every revision is written in.
   */
  static empty<TDoc extends object, TProv extends object | null = null>(
    itemId: string,
    locale: Locale,
  ): RevisionHistory<TDoc, TProv> {
    return new RevisionHistory(itemId, locale, new Map(), null);
  }

  /**
   * Rebuilds a history from the revisions a repository loaded, none of them unsaved. Nothing is
   * re-checked: the database proves each revision belongs to this item and locale (composite keys)
   * and numbers are unique.
   * @param itemId the item's identity.
   * @param locale the history's locale.
   * @param snapshot the loaded revisions, in any order; the highest number is the latest.
   */
  static reconstitute<TDoc extends object, TProv extends object | null = null>(
    itemId: string,
    locale: Locale,
    snapshot: RevisionHistorySnapshot<TDoc, TProv>,
  ): RevisionHistory<TDoc, TProv> {
    const held = new Map<string, Revision<TDoc, TProv>>();
    let newest: Revision<TDoc, TProv> | null = null;
    for (const revision of snapshot.revisions) {
      held.set(revision.id, revision);
      if (!newest || revision.number > newest.number) newest = revision;
    }
    return new RevisionHistory(itemId, locale, held, newest);
  }

  /**
   * The newest revision.
   * @returns the revision with the highest number, or null when the history is empty.
   */
  latest(): Revision<TDoc, TProv> | null {
    return this.newest;
  }

  /**
   * A revision this history holds (loaded or appended), by id.
   * @param revisionId the revision's identity.
   * @returns the revision, or null when it is not held (unknown, or older and not loaded).
   */
  get(revisionId: string): Revision<TDoc, TProv> | null {
    return this.held.get(revisionId) ?? null;
  }

  /**
   * Whether a revision can be one of this history: same item, same locale, and either the latest or
   * numbered below it. Used for a revision the caller loaded by id (a rollback), which the history
   * may not hold.
   * @param revision the candidate revision.
   * @returns true when it belongs.
   */
  belongs(revision: Revision<TDoc, TProv>): boolean {
    return (
      revision.itemId === this.itemId &&
      revision.locale === this.locale &&
      this.newest !== null &&
      (revision.number < this.newest.number || revision.id === this.newest.id)
    );
  }

  /**
   * Appends a revision numbered one above the latest; no earlier revision changes. Checks no rule
   * on the document: the holder checks its format first.
   * @param document the snapshot's public content; copied and frozen.
   * @param provenance the revision's private data, or null for a type that has none; copied and frozen.
   * @param origin who wrote it (Q3 A).
   * @param revisionId the new revision's identity, chosen by the use case.
   * @param at the save time, from the use case's clock.
   * @returns the new revision, now the latest.
   */
  append(
    document: TDoc,
    provenance: TProv,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<TDoc, TProv> {
    const revision = Revision.create<TDoc, TProv>({
      id: revisionId,
      itemId: this.itemId,
      locale: this.locale,
      number: (this.newest?.number ?? 0) + 1,
      origin,
      document,
      provenance,
      createdAt: at,
    });
    this.held.set(revision.id, revision);
    this.appended.push(revision);
    this.newest = revision;
    return revision;
  }

  /**
   * The revisions appended since the history was created or loaded, which a repository inserts.
   * @returns them in the order they were appended, which is their number order.
   */
  unsavedRevisions(): readonly Revision<TDoc, TProv>[] {
    return [...this.appended];
  }

  /**
   * What a repository stores and reads back: the mirror of `reconstitute`'s input.
   * @returns the held revisions (loaded and appended), oldest first.
   */
  snapshot(): RevisionHistorySnapshot<TDoc, TProv> {
    return { revisions: [...this.held.values()].sort((a, b) => a.number - b.number) };
  }
}
