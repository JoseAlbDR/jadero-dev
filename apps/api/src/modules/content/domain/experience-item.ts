import type { Locale } from "./locale.js";
import {
  LocalizedRevisions,
  type LocalizedRevisionsSnapshot,
  type LocalizedRevisionsView,
  type PublishResult,
  type PublishTarget,
} from "./localized-revisions.js";
import type { Revision, RevisionOrigin } from "./revision.js";
import { isFilled } from "./slug.js";

/** Where the work happened. */
export type LocationType = "remote" | "hybrid" | "onsite";

/** A span with month precision, `YYYY-MM`; `to: null` while it lasts. */
export interface Period {
  readonly from: string;
  readonly to: string | null;
}

/**
 * One locale of an experience item, the content of a revision (Q1 B). The organization's public
 * name lives here, not on the root: it is a statement about the owner, so it goes live only through
 * publish (ADR-011). The highlights are CV bullets, their own aggregate (D1).
 */
export interface ExperienceItemDocument {
  readonly organization: string;
  readonly role: string;
  readonly period: Period;
  readonly locationType: LocationType;
  readonly stackTags: readonly string[];
}

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Whether an experience document can be published: an organization, a role and a valid period
 * (`YYYY-MM`, the end not before the start).
 * @param document one locale's revision content.
 * @returns true when every required field is filled.
 */
export function isExperienceItemComplete(document: ExperienceItemDocument): boolean {
  const { from, to } = document.period;
  const validPeriod = YEAR_MONTH.test(from) && (to === null || (YEAR_MONTH.test(to) && from <= to));
  return isFilled(document.organization) && isFilled(document.role) && validPeriod;
}

/** The layout fields of an experience item, kept on the root (Q1 B). */
export interface ExperienceItemLayout {
  readonly id: string;
  readonly sortOrder: number;
}

/** An experience item as a repository reads it back. */
export interface StoredExperienceItem extends ExperienceItemLayout {
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<ExperienceItemDocument>;
}

/** The experience item aggregate (D1); its CV bullets point at it by id (step 4). */
export class ExperienceItem implements ExperienceItemLayout {
  readonly id: string;
  readonly sortOrder: number;

  private constructor(
    layout: ExperienceItemLayout,
    readonly version: number,
    private readonly machine: LocalizedRevisions<ExperienceItemDocument>,
  ) {
    this.id = layout.id;
    this.sortOrder = layout.sortOrder;
  }

  /**
   * Creates an experience item with no revision in any locale, at version 0 (never stored).
   * @param layout the identity, chosen by the use case, and the display order.
   */
  static create(layout: ExperienceItemLayout): ExperienceItem {
    return new ExperienceItem(
      layout,
      0,
      LocalizedRevisions.empty(layout.id, isExperienceItemComplete),
    );
  }

  /**
   * Rebuilds a stored experience item without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredExperienceItem): ExperienceItem {
    return new ExperienceItem(
      stored,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, isExperienceItemComplete, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<ExperienceItemDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full item, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the item is archived.
   */
  saveRevision(
    locale: Locale,
    document: ExperienceItemDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<ExperienceItemDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<ExperienceItemDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the item, hiding every locale.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
