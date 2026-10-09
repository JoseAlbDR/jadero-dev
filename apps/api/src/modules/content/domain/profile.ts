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

/** The kind of a profile link, which picks its icon and label in `web`. */
export type ProfileLinkKind = "email" | "github" | "linkedin" | "website";

/** One contact link; the URL format is checked by the schema at the boundary. */
export interface ProfileLink {
  readonly kind: ProfileLinkKind;
  readonly url: string;
}

/** One locale of the profile, the content of a revision (Q1 B). Text may be empty in a draft. */
export interface ProfileDocument {
  readonly name: string;
  readonly headline: string;
  /** Markdown, stored raw (ADR-011). */
  readonly summary: string;
  readonly links: readonly ProfileLink[];
}

/**
 * Whether a profile document can be published: a name, a headline, a summary, and a URL on every
 * link. Links are optional.
 * @param document one locale's revision content.
 * @returns true when every required field is filled.
 */
export function isProfileComplete(document: ProfileDocument): boolean {
  return (
    isFilled(document.name) &&
    isFilled(document.headline) &&
    isFilled(document.summary) &&
    document.links.every((link) => isFilled(link.url))
  );
}

/** The profile as a repository reads it back. */
export interface StoredProfile {
  readonly id: string;
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<ProfileDocument>;
}

/**
 * The profile aggregate (ADR-011), a singleton: one row exists, which the persistence enforces. It
 * has no layout fields; everything it says lives in its revisions.
 */
export class Profile {
  private constructor(
    readonly id: string,
    readonly version: number,
    private readonly machine: LocalizedRevisions<ProfileDocument>,
  ) {}

  /**
   * Creates the profile with no revision in any locale, at version 0 (never stored).
   * @param id the identity, chosen by the use case.
   */
  static create(id: string): Profile {
    return new Profile(id, 0, LocalizedRevisions.empty(id, isProfileComplete));
  }

  /**
   * Rebuilds the stored profile without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredProfile): Profile {
    return new Profile(
      stored.id,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, isProfileComplete, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<ProfileDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full profile, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the profile is archived.
   */
  saveRevision(
    locale: Locale,
    document: ProfileDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<ProfileDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<ProfileDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the profile, hiding every locale.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
