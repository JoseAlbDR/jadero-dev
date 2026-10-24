import { isFilled } from "./field-formats.js";
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

/** One locale of the /now page, the content of a revision (Q1 B). The body may be empty in a draft. */
export interface NowDocument {
  /** Markdown, stored raw (ADR-011). */
  readonly body: string;
}

/**
 * The rules of a Now document. Nothing to check on save (Markdown is free text); complete for
 * publish when the body is filled, which is what `nowDto` requires.
 */
export const nowRules: DocumentRules<NowDocument> = {
  invalidFields: () => [],
  isComplete: (doc) => isFilled(doc.body),
};

/** The Now page as a repository reads it back. */
export interface StoredNow {
  readonly id: string;
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<NowDocument>;
}

/**
 * The Now aggregate (WP-39 D2, ADR-034), a singleton like `Profile`: one row exists, which the
 * persistence enforces. What the owner is doing these days, one Markdown text per locale, with
 * revisions and a published pointer per locale. It cannot be archived: with no restore, an archived
 * singleton would stay hidden and locked for good.
 */
export class Now {
  private constructor(
    readonly id: string,
    readonly version: number,
    private readonly machine: LocalizedRevisions<NowDocument>,
  ) {}

  /**
   * Creates the Now page with no revision in any locale, at version 0 (never stored).
   * @param id the identity, chosen by the use case.
   */
  static create(id: string): Now {
    return new Now(id, 0, LocalizedRevisions.empty(id, nowRules));
  }

  /**
   * Rebuilds the stored Now page without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredNow): Now {
    return new Now(
      stored.id,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, nowRules, stored.translations),
    );
  }

  /** The per-locale state and revisions, read only. */
  get translations(): LocalizedRevisionsView<NowDocument> {
    return this.machine;
  }

  /**
   * What a repository stores: the exact mirror of `reconstitute`'s input, at the version it was
   * loaded at (the repository's optimistic check, D5).
   * @returns the root fields and the per-locale pointers.
   */
  snapshot(): StoredNow {
    return { id: this.id, version: this.version, translations: this.machine.snapshot() };
  }

  /**
   * The revisions saved since this aggregate was created or loaded, which the repository inserts.
   * @returns per locale (es, en, de), each locale's revisions in number order.
   */
  unsavedRevisions(): readonly Revision<NowDocument>[] {
    return this.machine.unsavedRevisions();
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full text, possibly empty.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   */
  saveRevision(
    locale: Locale,
    document: NowDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<NowDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<NowDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }
}
