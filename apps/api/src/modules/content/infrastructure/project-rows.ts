import { z } from "zod";
import { Project, type ProjectDocument, type ProjectKind } from "../domain/project.js";
import {
  keysOf,
  type LocalizedItemRows,
  localizedRows,
  localizedSnapshot,
  publishedSlugOf,
  publishedSlugRule,
  type RevisionRow,
  readStored,
  type SlugTranslationRow,
} from "./revision-rows.js";

/**
 * The stored shape of a project revision's document (Q1 B), read with it and written through it.
 * Structure only: the format and completeness rules are the domain's, checked at save and publish.
 */
export const projectDocumentSchema: z.ZodType<ProjectDocument> = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  stackTags: z.array(z.string()),
  repoUrl: z.string().nullable(),
  demoUrl: z.string().nullable(),
});

const projectKinds = {
  case_study: true,
  project: true,
  early: true,
} as const satisfies Record<ProjectKind, true>;

const projectKindSchema = z.enum(keysOf(projectKinds));

/** A `content.projects` row. */
export interface ProjectBaseRow {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly featured: boolean;
  readonly sortOrder: number;
  readonly archivedAt: Date | null;
  readonly version: number;
}

/** A `content.project_translations` row: the shared pointers plus the published slug. */
export type ProjectTranslationRow = SlugTranslationRow;

/** What one project save writes. */
export type ProjectRows = LocalizedItemRows<ProjectBaseRow, ProjectTranslationRow>;

/**
 * The rows of a project at its next version. Each locale's published slug is copied from its
 * published revision's document, so `(locale, published_slug)` finds the page (D3).
 * @param project the aggregate after the use case changed it.
 * @param version the version the root row will hold.
 * @returns the root row, every translation row, and the unsaved revisions.
 */
export function projectToRows(project: Project, version: number): ProjectRows {
  const stored = project.snapshot();
  return {
    base: {
      id: stored.id,
      slug: stored.slug,
      kind: stored.kind,
      featured: stored.featured,
      sortOrder: stored.sortOrder,
      archivedAt: stored.translations.archivedAt,
      version,
    },
    ...localizedRows(
      stored.id,
      stored.translations,
      project.unsavedRevisions(),
      projectDocumentSchema,
      publishedSlugOf,
    ),
  };
}

/**
 * Rebuilds a project from its rows. Besides what `localizedSnapshot` checks, it holds the rule the
 * database cannot prove: each locale's published slug is its published revision's slug (a mapper
 * bug would otherwise route a URL to another text).
 * @param base the root row.
 * @param translations its translation rows.
 * @param revisions at least the revisions they point at.
 * @returns the project at the stored version.
 * @throws {StoredStateInvalid} when a row or a document cannot be read back, or a slug disagrees.
 */
export function projectFromRows(
  base: ProjectBaseRow,
  translations: readonly ProjectTranslationRow[],
  revisions: readonly RevisionRow[],
): Project {
  return Project.reconstitute({
    id: base.id,
    slug: base.slug,
    kind: readStored(projectKindSchema, base.kind, base.id, "kind"),
    featured: base.featured,
    sortOrder: base.sortOrder,
    version: base.version,
    translations: localizedSnapshot(
      base.id,
      translations,
      revisions,
      projectDocumentSchema,
      base.archivedAt,
      publishedSlugRule(base.id),
    ),
  });
}
