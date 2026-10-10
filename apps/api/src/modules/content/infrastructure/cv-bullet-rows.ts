import {
  cvBulletDocumentSchema,
  cvBulletImportanceSchema,
} from "../application/content-documents.js";
import { StoredStateInvalid } from "../domain/content.errors.js";
import { CvBullet, type CvBulletParent } from "../domain/cv-bullet.js";
import {
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  type RevisionRow,
  readStored,
  type TranslationRow,
} from "./revision-rows.js";

/** The parent columns of a `content.cv_bullets` row: exactly one is set (its CHECK). */
export interface CvBulletParentColumns {
  readonly experienceItemId: string | null;
  readonly projectId: string | null;
}

/** A `content.cv_bullets` row, keyed by the human id. */
export interface CvBulletBaseRow extends CvBulletParentColumns {
  readonly id: string;
  readonly sortOrder: number;
  readonly importance: number;
  readonly archivedAt: Date | null;
  readonly version: number;
}

/**
 * The parent columns of a bullet: the domain's union becomes two nullable foreign keys.
 * @param parent the bullet's parent.
 * @returns the experience item column or the project column set, the other null.
 */
export function parentColumns(parent: CvBulletParent): CvBulletParentColumns {
  return parent.kind === "experience-item"
    ? { experienceItemId: parent.experienceItemId, projectId: null }
    : { experienceItemId: null, projectId: parent.projectId };
}

/**
 * The parent a stored row names. The CHECK makes "both" and "neither" impossible in Postgres; the
 * mapper still refuses them, so the fake cannot read back a row Postgres would refuse.
 * @param base the root row.
 * @returns the domain's parent.
 * @throws {StoredStateInvalid} when not exactly one parent column is set.
 */
function parentFromRow(base: CvBulletBaseRow): CvBulletParent {
  if (base.experienceItemId !== null && base.projectId === null) {
    return { kind: "experience-item", experienceItemId: base.experienceItemId };
  }
  if (base.projectId !== null && base.experienceItemId === null) {
    return { kind: "project", projectId: base.projectId };
  }
  throw new StoredStateInvalid(base.id, "it does not name exactly one parent");
}

/**
 * The rows of a bullet at its next version. The parent columns are part of the root row, but the
 * repositories write them only when they insert it: the parent is fixed at creation.
 * @param bullet the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 */
export function cvBulletToRows(
  bullet: CvBullet,
  version: number,
): LocalizedItemRows<CvBulletBaseRow> {
  const stored = bullet.snapshot();
  return {
    base: {
      id: stored.id,
      ...parentColumns(stored.parent),
      sortOrder: stored.sortOrder,
      importance: stored.importance,
      archivedAt: stored.translations.archivedAt,
      version,
    },
    ...localizedRows(
      stored.id,
      stored.translations,
      bullet.unsavedRevisions(),
      cvBulletDocumentSchema,
    ),
  };
}

/**
 * Rebuilds a bullet from its rows: its parent from the two columns, its importance parsed.
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the bullet at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back, or the parent is not one.
 */
export function cvBulletFromRows(
  base: CvBulletBaseRow,
  translations: readonly TranslationRow[],
  revisions: readonly RevisionRow[],
): CvBullet {
  return CvBullet.reconstitute({
    id: base.id,
    parent: parentFromRow(base),
    sortOrder: base.sortOrder,
    importance: readStored(cvBulletImportanceSchema, base.importance, base.id, "importance"),
    version: base.version,
    translations: localizedSnapshot(
      base.id,
      translations,
      revisions,
      cvBulletDocumentSchema,
      base.archivedAt,
    ),
  });
}
