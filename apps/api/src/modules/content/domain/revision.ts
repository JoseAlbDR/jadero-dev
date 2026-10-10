import type { Locale } from "./locale.js";

/**
 * Who wrote a revision (Q3 A): the owner, or a machine such as the translation assistant (WP-32).
 * Publishing is the owner's review of a machine revision; there is no extra state.
 */
export type RevisionOrigin = "owner" | "machine";

/** The fields of a revision, as the aggregate creates it or a repository reads it back. */
export interface RevisionProps<TDoc extends object, TProv extends object | null = null> {
  readonly id: string;
  readonly itemId: string;
  readonly locale: Locale;
  /** 1, 2, 3 ... per item and locale. */
  readonly number: number;
  readonly origin: RevisionOrigin;
  /**
   * One locale's full item: the text and the fields shared by every locale (Q1 B). Only what is
   * public once published or approved, so it can be the event payload of WP-14 as is.
   */
  readonly document: TDoc;
  /**
   * Private data written with the revision and never public (a knowledge entry's provenance,
   * D-67); `null` for every type that has none.
   */
  readonly provenance: TProv;
  readonly createdAt: Date;
}

/**
 * One saved version of one locale of one item (D2): an immutable snapshot. Every save appends a new
 * revision; none is ever changed, so publishing an older one is a rollback by pointer. The document
 * and the provenance are deep-frozen copies, and the creation time is kept as epoch milliseconds
 * (a frozen `Date` can still be changed with `setTime`), so nothing a caller holds can alter it.
 */
export class Revision<TDoc extends object, TProv extends object | null = null> {
  readonly id: string;
  readonly itemId: string;
  readonly locale: Locale;
  readonly number: number;
  readonly origin: RevisionOrigin;
  readonly document: TDoc;
  readonly provenance: TProv;
  private readonly createdAtMs: number;

  private constructor(props: RevisionProps<TDoc, TProv>) {
    this.id = props.id;
    this.itemId = props.itemId;
    this.locale = props.locale;
    this.number = props.number;
    this.origin = props.origin;
    this.document = frozenCopy(props.document);
    this.provenance = frozenCopy(props.provenance);
    this.createdAtMs = props.createdAt.getTime();
    Object.freeze(this);
  }

  /**
   * Creates a new revision. Called by `RevisionHistory`, which computes the number from the latest
   * revision; other code saves through an aggregate's `saveRevision`.
   * @param props the revision's fields; the document and the provenance are copied and frozen.
   * @returns the frozen revision.
   */
  static create<TDoc extends object, TProv extends object | null = null>(
    props: RevisionProps<TDoc, TProv>,
  ): Revision<TDoc, TProv> {
    return new Revision(props);
  }

  /**
   * Rebuilds a stored revision (a repository reading a row, or a use case loading an older revision
   * by id for a rollback). Nothing is re-checked: the row passed the rules when it was saved.
   * @param props the stored fields; the document and the provenance are copied and frozen.
   * @returns the frozen revision.
   */
  static reconstitute<TDoc extends object, TProv extends object | null = null>(
    props: RevisionProps<TDoc, TProv>,
  ): Revision<TDoc, TProv> {
    return new Revision(props);
  }

  /** When the revision was saved: a new `Date` on every read, so changing it changes nothing here. */
  get createdAt(): Date {
    return new Date(this.createdAtMs);
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
