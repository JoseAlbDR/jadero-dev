import { isFilled, isUrlWith } from "./field-formats.js";
import type { Locale } from "./locale.js";
import {
  type DocumentRules,
  LocalizedRevisions,
  type LocalizedRevisionsSnapshot,
  type LocalizedRevisionsView,
  type PublishResult,
  type PublishTarget,
} from "./localized-revisions.js";
import type { Revision, RevisionOrigin } from "./revision.js";

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
 * The rules of a profile document. Format on save: every link URL is HTTPS or `mailto:`.
 * Complete for publish: what `profileDto` requires (a name and a headline) plus the summary, the
 * profile's body.
 */
export const profileRules: DocumentRules<ProfileDocument> = {
  invalidFields: (doc) =>
    doc.links.flatMap((link, index) =>
      isUrlWith(link.url, ["https", "mailto"]) ? [] : [`links[${index}].url`],
    ),
  isComplete: (doc) => isFilled(doc.name) && isFilled(doc.headline) && isFilled(doc.summary),
};

/** The profile as a repository reads it back. */
export interface StoredProfile {
  readonly id: string;
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<ProfileDocument>;
}

/**
 * The profile aggregate (ADR-011), a singleton: one row exists, which the persistence enforces. It
 * has no layout fields; everything it says lives in its revisions. It cannot be archived: with no
 * restore, an archived singleton would stay hidden and locked for good.
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
    return new Profile(id, 0, LocalizedRevisions.empty(id, profileRules));
  }

  /**
   * Rebuilds the stored profile without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredProfile): Profile {
    return new Profile(
      stored.id,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, profileRules, stored.translations),
    );
  }

  /** The per-locale state and revisions, read only. */
  get translations(): LocalizedRevisionsView<ProfileDocument> {
    return this.machine;
  }

  /**
   * What a repository stores: the exact mirror of `reconstitute`'s input, at the version it was
   * loaded at (the repository's optimistic check, D5).
   * @returns the root fields and the per-locale pointers.
   */
  snapshot(): StoredProfile {
    return { id: this.id, version: this.version, translations: this.machine.snapshot() };
  }

  /**
   * The revisions saved since this aggregate was created or loaded, which the repository inserts.
   * After the save the use case discards the aggregate and the next one loads it again.
   * @returns per locale (es, en, de), each locale's revisions in number order.
   */
  unsavedRevisions(): readonly Revision<ProfileDocument>[] {
    return this.machine.unsavedRevisions();
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full profile, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
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
}
