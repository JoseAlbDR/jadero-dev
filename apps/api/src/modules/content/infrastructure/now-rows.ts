import { nowDocumentSchema } from "../application/content-documents.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { Now } from "../domain/now.js";
import {
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  type RevisionRow,
  type TranslationRow,
} from "./revision-rows.js";

/** A `content.now` row: the id and the version, nothing else (no layout, no archive). */
export interface NowBaseRow {
  readonly id: string;
  readonly version: number;
}

/**
 * The rows of the Now page at its next version. The table has no `archived_at` (a singleton with
 * no restore would lock itself), so an archive mark is refused here instead of dropped.
 * @param now the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 * @throws {StoredStateInvalid} when the Now page carries an archive mark.
 */
export function nowToRows(now: Now, version: number): LocalizedItemRows<NowBaseRow> {
  const stored = now.snapshot();
  if (stored.translations.archivedAt !== null) {
    throw new StoredStateInvalid(stored.id, "it is archived, and Now has no archive column");
  }
  return {
    base: { id: stored.id, version },
    ...localizedRows(stored.id, stored.translations, now.unsavedRevisions(), nowDocumentSchema),
  };
}

/**
 * Rebuilds the Now page from its rows; it is never archived.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the Now page at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back.
 */
export function nowFromRows(
  base: NowBaseRow,
  translations: readonly TranslationRow[],
  revisions: readonly RevisionRow[],
): Now {
  return Now.reconstitute({
    id: base.id,
    version: base.version,
    translations: localizedSnapshot(base.id, translations, revisions, nowDocumentSchema, null),
  });
}
