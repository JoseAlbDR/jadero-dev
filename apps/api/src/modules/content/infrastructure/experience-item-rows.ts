import { z } from "zod";
import {
  ExperienceItem,
  type ExperienceItemDocument,
  type LocationType,
} from "../domain/experience-item.js";
import {
  keysOf,
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  type RevisionRow,
  type TranslationRow,
} from "./revision-rows.js";

const locationTypes = {
  remote: true,
  hybrid: true,
  onsite: true,
} as const satisfies Record<LocationType, true>;

/**
 * The stored shape of an experience item revision's document (Q1 B), read with it and written
 * through it. Structure only: the format and completeness rules are the domain's.
 */
export const experienceItemDocumentSchema: z.ZodType<ExperienceItemDocument> = z.object({
  organization: z.string(),
  role: z.string(),
  period: z.object({ from: z.string(), to: z.string().nullable() }),
  locationType: z.enum(keysOf(locationTypes)),
  stackTags: z.array(z.string()),
});

/** A `content.experience_items` row: identity and layout. */
export interface ExperienceItemBaseRow {
  readonly id: string;
  readonly sortOrder: number;
  readonly archivedAt: Date | null;
  readonly version: number;
}

/**
 * The rows of an experience item at its next version.
 * @param item the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 */
export function experienceItemToRows(
  item: ExperienceItem,
  version: number,
): LocalizedItemRows<ExperienceItemBaseRow> {
  const stored = item.snapshot();
  return {
    base: {
      id: stored.id,
      sortOrder: stored.sortOrder,
      archivedAt: stored.translations.archivedAt,
      version,
    },
    ...localizedRows(
      stored.id,
      stored.translations,
      item.unsavedRevisions(),
      experienceItemDocumentSchema,
    ),
  };
}

/**
 * Rebuilds an experience item from its rows through the shared checks of `localizedSnapshot`.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the item at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back.
 */
export function experienceItemFromRows(
  base: ExperienceItemBaseRow,
  translations: readonly TranslationRow[],
  revisions: readonly RevisionRow[],
): ExperienceItem {
  return ExperienceItem.reconstitute({
    id: base.id,
    sortOrder: base.sortOrder,
    version: base.version,
    translations: localizedSnapshot(
      base.id,
      translations,
      revisions,
      experienceItemDocumentSchema,
      base.archivedAt,
    ),
  });
}
