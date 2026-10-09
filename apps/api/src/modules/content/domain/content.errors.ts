import type { Locale } from "./locale.js";

/**
 * A publish named a locale whose revision is missing or has required fields empty, or an approval
 * named a knowledge entry revision (English) with required fields empty. The presentation layer maps
 * it to 422 (WP-13).
 */
export class LocaleIncomplete extends Error {
  constructor(
    readonly itemId: string,
    readonly locale: Locale,
    readonly action: "publish" | "approve" = "publish",
  ) {
    super(`Item ${itemId} has no complete revision in ${locale} to ${action}.`);
    this.name = "LocaleIncomplete";
  }
}

/**
 * After the publish, a required locale (es or en, D-20) would still be unpublished, so the item
 * would go public in one required language only. Maps to 422.
 */
export class RequiredLocalesMissing extends Error {
  constructor(
    readonly itemId: string,
    readonly missing: readonly Locale[],
  ) {
    super(`Item ${itemId} cannot be published without ${missing.join(" and ")}.`);
    this.name = "RequiredLocalesMissing";
  }
}

/**
 * The action is not a transition of the publish or approval state machine from the current state
 * (an archived item, a publish that names a locale twice, a deleted entry, an approval of a withdrawn
 * entry). Maps to 409.
 */
export class InvalidTransition extends Error {
  constructor(
    readonly itemId: string,
    readonly action: string,
    readonly reason: string,
  ) {
    super(`Cannot ${action} item ${itemId}: ${reason}.`);
    this.name = "InvalidTransition";
  }
}

/**
 * A revision given to publish (a rollback) is not a known revision of this item and locale. Maps
 * to 409: the caller loaded it for another item or locale, or from a newer state than the aggregate.
 */
export class RevisionNotOfItem extends Error {
  constructor(
    readonly itemId: string,
    readonly locale: Locale,
    readonly revisionId: string,
  ) {
    super(`Revision ${revisionId} is not a ${locale} revision of item ${itemId}.`);
    this.name = "RevisionNotOfItem";
  }
}

/**
 * A saved document holds a value in the wrong format (a slug with spaces, a URL that is not HTTPS).
 * Empty fields are allowed in a draft; malformed ones never reach storage. Maps to 422.
 */
export class FieldFormatInvalid extends Error {
  constructor(
    readonly itemId: string,
    readonly locale: Locale,
    readonly fields: readonly string[],
  ) {
    super(`Item ${itemId} in ${locale} has malformed fields: ${fields.join(", ")}.`);
    this.name = "FieldFormatInvalid";
  }
}

/** A canonical slug breaks the slug rule (lowercase words joined by hyphens). Maps to 422. */
export class SlugInvalid extends Error {
  constructor(readonly attempted: string) {
    super("A slug must be lowercase letters and digits joined by single hyphens, at most 120.");
    this.name = "SlugInvalid";
  }
}

/**
 * An approval named a revision that is not the entry's latest (D4, Trace 2a): someone saved a newer
 * one since the owner's preview, so the owner would approve text they never read. Maps to 409.
 */
export class RevisionNotLatest extends Error {
  constructor(
    readonly itemId: string,
    readonly revisionId: string,
    readonly latestRevisionId: string | null,
  ) {
    super(`Revision ${revisionId} is not the latest revision of item ${itemId}.`);
    this.name = "RevisionNotLatest";
  }
}

/**
 * An approval left boxes of the ADR-031 checklist unticked; every box is required. Maps to 422.
 */
export class ChecklistIncomplete extends Error {
  constructor(
    readonly itemId: string,
    readonly unchecked: readonly string[],
  ) {
    super(`Item ${itemId} cannot be approved with unchecked boxes: ${unchecked.join(", ")}.`);
    this.name = "ChecklistIncomplete";
  }
}

/**
 * A human id breaks its format: a CV bullet id (`backend-10`) or a knowledge entry id
 * (`kb-outbox-relay`). Maps to 422.
 */
export class IdInvalid extends Error {
  constructor(
    readonly kind: "cv-bullet" | "knowledge-entry",
    readonly attempted: string,
  ) {
    super(
      kind === "cv-bullet"
        ? "A CV bullet id must be lowercase letters and digits joined by single hyphens, at most 80."
        : "A knowledge entry id must be kb- and lowercase words joined by single hyphens, at most 120.",
    );
    this.name = "IdInvalid";
  }
}

/**
 * A repository handed an aggregate a stored state its state machine can never reach: an approved
 * entry with no approval, an approval bound to a revision that was not loaded, an entry with no
 * revision. A bug in the repository or a corrupt row, never a caller's mistake: maps to 500.
 */
export class StoredStateInvalid extends Error {
  constructor(
    readonly itemId: string,
    readonly reason: string,
  ) {
    super(`Stored item ${itemId} is in an impossible state: ${reason}.`);
    this.name = "StoredStateInvalid";
  }
}

/**
 * A save named a version the item is no longer at (D5, optimistic concurrency): someone saved it
 * since this caller loaded it (the lost update it prevents), or a create (`expectedVersion` 0) named
 * an id that already exists. The unit of work rolls back everything the work wrote. Maps to 409.
 */
export class ConcurrentModification extends Error {
  constructor(
    readonly itemId: string,
    readonly expectedVersion: number,
  ) {
    super(
      expectedVersion === 0
        ? `Item ${itemId} already exists.`
        : `Item ${itemId} is no longer at version ${expectedVersion}.`,
    );
    this.name = "ConcurrentModification";
  }
}
