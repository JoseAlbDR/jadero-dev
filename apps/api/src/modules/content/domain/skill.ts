import { invalidEntries, isFilled, isSlug } from "./field-formats.js";
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

/** One locale of a skill, the content of a revision (Q1 B). Text may be empty in a draft. */
export interface SkillDocument {
  readonly name: string;
  /** A localized display string ("IA aplicada", "applied AI"). */
  readonly category: string;
  /** Canonical slugs of the projects that show the skill: references by identity (D1). */
  readonly projectSlugs: readonly string[];
}

/**
 * The rules of a skill document. Format on save: project slugs that are slugs. Complete for publish:
 * what `skillDto` requires (a name and a category).
 */
export const skillRules: DocumentRules<SkillDocument> = {
  invalidFields: (doc) => invalidEntries("projectSlugs", doc.projectSlugs, isSlug),
  isComplete: (doc) => isFilled(doc.name) && isFilled(doc.category),
};

/** The layout fields of a skill, kept on the root (Q1 B). */
export interface SkillLayout {
  readonly id: string;
  readonly sortOrder: number;
}

/** A skill as a repository reads it back. */
export interface StoredSkill extends SkillLayout {
  readonly version: number;
  readonly translations: LocalizedRevisionsSnapshot<SkillDocument>;
}

/** The skill aggregate (D1). */
export class Skill implements SkillLayout {
  readonly id: string;
  readonly sortOrder: number;

  private constructor(
    layout: SkillLayout,
    readonly version: number,
    private readonly machine: LocalizedRevisions<SkillDocument>,
  ) {
    this.id = layout.id;
    this.sortOrder = layout.sortOrder;
  }

  /**
   * Creates a skill with no revision in any locale, at version 0 (never stored).
   * @param layout the identity, chosen by the use case, and the display order.
   */
  static create(layout: SkillLayout): Skill {
    return new Skill(layout, 0, LocalizedRevisions.empty(layout.id, skillRules));
  }

  /**
   * Rebuilds a stored skill without re-checking its rules.
   * @param stored the root row, its version and its per-locale pointers.
   */
  static reconstitute(stored: StoredSkill): Skill {
    return new Skill(
      stored,
      stored.version,
      LocalizedRevisions.reconstitute(stored.id, skillRules, stored.translations),
    );
  }

  /** The per-locale state, revisions and archive mark, read only. */
  get translations(): LocalizedRevisionsView<SkillDocument> {
    return this.machine;
  }

  /**
   * Saves a new revision of one locale; the published one stays live until the next publish.
   * @param locale the locale written.
   * @param document one locale's full skill, possibly incomplete.
   * @param origin who wrote it.
   * @param revisionId the new revision's identity.
   * @param at the save time.
   * @returns the new revision.
   * @throws {InvalidTransition} when the skill is archived.
   * @throws {FieldFormatInvalid} when a field holds a malformed value.
   */
  saveRevision(
    locale: Locale,
    document: SkillDocument,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<SkillDocument> {
    return this.machine.append(locale, document, origin, revisionId, at);
  }

  /**
   * Publishes the named locales under the guards of D4 (see `LocalizedRevisions.publish`).
   * @param targets the locales, each alone (its latest) or with an older revision (a rollback).
   * @param at the publish time.
   * @returns what changed, and a warning per optional locale left unpublished.
   */
  publish(targets: readonly PublishTarget<SkillDocument>[], at: Date): PublishResult {
    return this.machine.publish(targets, at);
  }

  /**
   * Archives the skill, hiding every locale.
   * @param at the archive time.
   * @throws {InvalidTransition} when it is already archived.
   */
  archive(at: Date): void {
    this.machine.archive(at);
  }
}
