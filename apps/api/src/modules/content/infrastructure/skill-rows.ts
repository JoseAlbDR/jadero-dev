import { z } from "zod";
import { Skill, type SkillDocument } from "../domain/skill.js";
import {
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  type RevisionRow,
  type TranslationRow,
} from "./revision-rows.js";

/**
 * The stored shape of a skill revision's document (Q1 B). Structure only: the format and
 * completeness rules are the domain's.
 */
export const skillDocumentSchema: z.ZodType<SkillDocument> = z.object({
  name: z.string(),
  category: z.string(),
  projectSlugs: z.array(z.string()),
});

/** A `content.skills` row: identity and layout. */
export interface SkillBaseRow {
  readonly id: string;
  readonly sortOrder: number;
  readonly archivedAt: Date | null;
  readonly version: number;
}

/**
 * The rows of a skill at its next version.
 * @param skill the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 */
export function skillToRows(skill: Skill, version: number): LocalizedItemRows<SkillBaseRow> {
  const stored = skill.snapshot();
  return {
    base: {
      id: stored.id,
      sortOrder: stored.sortOrder,
      archivedAt: stored.translations.archivedAt,
      version,
    },
    ...localizedRows(stored.id, stored.translations, skill.unsavedRevisions(), skillDocumentSchema),
  };
}

/**
 * Rebuilds a skill from its rows through the shared checks of `localizedSnapshot`.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the skill at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back.
 */
export function skillFromRows(
  base: SkillBaseRow,
  translations: readonly TranslationRow[],
  revisions: readonly RevisionRow[],
): Skill {
  return Skill.reconstitute({
    id: base.id,
    sortOrder: base.sortOrder,
    version: base.version,
    translations: localizedSnapshot(
      base.id,
      translations,
      revisions,
      skillDocumentSchema,
      base.archivedAt,
    ),
  });
}
