import type { Locale } from "./locale.js";

/**
 * A publish named a locale whose revision is missing or has required fields empty. The
 * presentation layer maps it to 422 (WP-13).
 */
export class LocaleIncomplete extends Error {
  constructor(
    readonly itemId: string,
    readonly locale: Locale,
  ) {
    super(`Item ${itemId} has no complete revision in ${locale} to publish.`);
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
 * The action is not a transition of the publish state machine from the current state (an archived
 * item, a revision that is already the published one). Maps to 409.
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

/** A canonical slug breaks the slug rule (lowercase words joined by hyphens). Maps to 422. */
export class SlugInvalid extends Error {
  constructor(readonly attempted: string) {
    super("A slug must be lowercase letters and digits joined by single hyphens, at most 120.");
    this.name = "SlugInvalid";
  }
}
