import type { Locale } from "./locale.js";
import { Revision, type RevisionOrigin } from "./revision.js";

/**
 * The revisions of one history a repository loaded: at least the latest, plus any other the
 * aggregate needs to hold (the published one of a locale, the approved one of an entry). Never the
 * whole history (D1): older revisions stay in their table and are loaded by id when needed.
 */
export interface RevisionHistorySnapshot<TDoc extends object> {
  readonly revisions: readonly Revision<TDoc>[];
}

/**
 * The append-only history of one item in one locale (D2): revisions are numbered 1, 2, 3 ... and
 * never changed; the latest is the one with the highest number. Shared by composition: every locale
 * of a `LocalizedRevisions` holds one, and a `KnowledgeEntry` (English only) holds exactly one. It
 * knows nothing about publishing or approval: the pointers into it belong to whoever holds it.
 */
export class RevisionHistory<TDoc extends object> {
  private constructor(
    private readonly itemId: string,
    private readonly locale: Locale,
    private readonly held: Map<string, Revision<TDoc>>,
    private newest: Revision<TDoc> | null,
  ) {}

  /**
   * An empty history: no revision yet.
   * @param itemId the item's identity, which every revision carries.
   * @param locale the locale every revision is written in.
   */
  static empty<TDoc extends object>(itemId: string, locale: Locale): RevisionHistory<TDoc> {
    return new RevisionHistory(itemId, locale, new Map(), null);
  }

  /**
   * Rebuilds a history from the revisions a repository loaded. Nothing is re-checked: the database
   * proves each revision belongs to this item and locale (composite keys) and numbers are unique.
   * @param itemId the item's identity.
   * @param locale the history's locale.
   * @param snapshot the loaded revisions, in any order; the highest number is the latest.
   */
  static reconstitute<TDoc extends object>(
    itemId: string,
    locale: Locale,
    snapshot: RevisionHistorySnapshot<TDoc>,
  ): RevisionHistory<TDoc> {
    const held = new Map<string, Revision<TDoc>>();
    let newest: Revision<TDoc> | null = null;
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
  latest(): Revision<TDoc> | null {
    return this.newest;
  }

  /**
   * A revision this history holds (loaded or appended), by id.
   * @param revisionId the revision's identity.
   * @returns the revision, or null when it is not held (unknown, or older and not loaded).
   */
  get(revisionId: string): Revision<TDoc> | null {
    return this.held.get(revisionId) ?? null;
  }

  /**
   * Whether a revision can be one of this history: same item, same locale, and either the latest or
   * numbered below it. Used for a revision the caller loaded by id (a rollback), which the history
   * may not hold.
   * @param revision the candidate revision.
   * @returns true when it belongs.
   */
  belongs(revision: Revision<TDoc>): boolean {
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
   * @param document the snapshot's content; copied and frozen.
   * @param origin who wrote it (Q3 A).
   * @param revisionId the new revision's identity, chosen by the use case.
   * @param at the save time, from the use case's clock.
   * @returns the new revision, now the latest.
   */
  append(document: TDoc, origin: RevisionOrigin, revisionId: string, at: Date): Revision<TDoc> {
    const revision = Revision.create({
      id: revisionId,
      itemId: this.itemId,
      locale: this.locale,
      number: (this.newest?.number ?? 0) + 1,
      origin,
      document,
      createdAt: at,
    });
    this.held.set(revision.id, revision);
    this.newest = revision;
    return revision;
  }

  /**
   * What a repository stores and reads back.
   * @returns the held revisions, oldest first.
   */
  snapshot(): RevisionHistorySnapshot<TDoc> {
    return { revisions: [...this.held.values()].sort((a, b) => a.number - b.number) };
  }
}
