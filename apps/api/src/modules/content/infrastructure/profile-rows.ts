import { z } from "zod";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { Profile, type ProfileDocument, type ProfileLinkKind } from "../domain/profile.js";
import {
  keysOf,
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  type RevisionRow,
  type TranslationRow,
} from "./revision-rows.js";

const linkKinds = {
  email: true,
  github: true,
  linkedin: true,
  website: true,
} as const satisfies Record<ProfileLinkKind, true>;

/**
 * The stored shape of a profile revision's document (Q1 B). Structure only: the URL formats and
 * completeness are the domain's rules.
 */
export const profileDocumentSchema: z.ZodType<ProfileDocument> = z.object({
  name: z.string(),
  headline: z.string(),
  summary: z.string(),
  links: z.array(z.object({ kind: z.enum(keysOf(linkKinds)), url: z.string() })),
});

/** A `content.profile` row: the id and the version, nothing else (no layout, no archive). */
export interface ProfileBaseRow {
  readonly id: string;
  readonly version: number;
}

/**
 * The rows of the profile at its next version. The table has no `archived_at` (a singleton with no
 * restore would lock itself), so an archive mark is refused here instead of dropped: a dropped one
 * would read back as not archived, and the change would be lost without a sign.
 * @param profile the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 * @throws {StoredStateInvalid} when the profile carries an archive mark.
 */
export function profileToRows(
  profile: Profile,
  version: number,
): LocalizedItemRows<ProfileBaseRow> {
  const stored = profile.snapshot();
  if (stored.translations.archivedAt !== null) {
    throw new StoredStateInvalid(
      stored.id,
      "it is archived, and the profile has no archive column",
    );
  }
  return {
    base: { id: stored.id, version },
    ...localizedRows(
      stored.id,
      stored.translations,
      profile.unsavedRevisions(),
      profileDocumentSchema,
    ),
  };
}

/**
 * Rebuilds the profile from its rows; it is never archived.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the profile at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back.
 */
export function profileFromRows(
  base: ProfileBaseRow,
  translations: readonly TranslationRow[],
  revisions: readonly RevisionRow[],
): Profile {
  return Profile.reconstitute({
    id: base.id,
    version: base.version,
    translations: localizedSnapshot(base.id, translations, revisions, profileDocumentSchema, null),
  });
}
