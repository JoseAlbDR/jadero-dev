import type { Locale } from "./locale.js";

/**
 * Who wrote a revision (Q3 A): the owner, or a machine such as the translation assistant (WP-32).
 * Publishing is the owner's review of a machine revision; there is no extra state.
 */
export type RevisionOrigin = "owner" | "machine";

/** The fields of a revision, as the aggregate creates it or a repository reads it back. */
export interface RevisionProps<TDoc extends object> {
  readonly id: string;
  readonly itemId: string;
  readonly locale: Locale;
  /** 1, 2, 3 ... per item and locale. */
  readonly number: number;
  readonly origin: RevisionOrigin;
  /** One locale's full item: the text and the fields shared by every locale (Q1 B). */
  readonly document: TDoc;
  readonly createdAt: Date;
}

/**
 * One saved version of one locale of one item (D2): an immutable snapshot. Every save appends a new
 * revision; none is ever changed, so publishing an older one is a rollback by pointer.
 */
export class Revision<TDoc extends object> implements RevisionProps<TDoc> {
  readonly id: string;
  readonly itemId: string;
  readonly locale: Locale;
  readonly number: number;
  readonly origin: RevisionOrigin;
  readonly document: TDoc;
  readonly createdAt: Date;

  private constructor(props: RevisionProps<TDoc>) {
    this.id = props.id;
    this.itemId = props.itemId;
    this.locale = props.locale;
    this.number = props.number;
    this.origin = props.origin;
    this.document = frozenCopy(props.document);
    this.createdAt = new Date(props.createdAt.getTime());
    Object.freeze(this);
  }

  /**
   * Creates a new revision. Called by `LocalizedRevisions`, which computes the number from the
   * latest revision of the locale; other code saves through an aggregate's `saveRevision`.
   * @param props the revision's fields; the document is copied and frozen.
   * @returns the frozen revision.
   */
  static create<TDoc extends object>(props: RevisionProps<TDoc>): Revision<TDoc> {
    return new Revision(props);
  }

  /**
   * Rebuilds a stored revision (a repository reading a row, or a use case loading an older revision
   * by id for a rollback). Nothing is re-checked: the row passed the rules when it was saved.
   * @param props the stored fields; the document is copied and frozen.
   * @returns the frozen revision.
   */
  static reconstitute<TDoc extends object>(props: RevisionProps<TDoc>): Revision<TDoc> {
    return new Revision(props);
  }
}

/** A deep copy that nobody can change: the caller's object stays theirs, the revision stays fixed. */
function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
