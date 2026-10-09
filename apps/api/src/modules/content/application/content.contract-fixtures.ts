import { randomUUID } from "node:crypto";
import type { ApprovalChecklist } from "../domain/approval-checklist.js";
import {
  KnowledgeEntry,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
} from "../domain/knowledge-entry.js";
import type { Locale } from "../domain/locale.js";
import { Project, type ProjectDocument } from "../domain/project.js";

// Placeholder content for the content contract suites (ADR-031: no real names). Ids are fresh per
// call, so the Drizzle runs share one database without seeing each other's rows; slugs carry a
// piece of the id, because published slugs are unique per locale across every test.

/**
 * A fixed instant plus some minutes, so every time a test stores is known exactly.
 * @param minutes minutes after 2026-10-10T10:00Z.
 * @returns the time.
 */
export function at(minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 10, 10, minutes));
}

/**
 * A new project with no revision, never stored.
 * @returns the project at version 0.
 */
export function newProject(): Project {
  const id = randomUUID();
  return Project.create({
    id,
    slug: `placeholder-${id.slice(0, 8)}`,
    kind: "project",
    featured: false,
    sortOrder: 1,
  });
}

/**
 * A complete project document for one locale.
 * @param project the project, whose id makes the localized slug unique.
 * @param locale the locale, part of the slug and the title.
 * @param title the title, to tell revisions apart.
 * @returns the document.
 */
export function projectDocument(
  project: Project,
  locale: Locale,
  title = "Placeholder",
): ProjectDocument {
  return {
    slug: `${locale}-placeholder-${project.id.slice(0, 8)}`,
    title: `${title} (${locale})`,
    summary: "A placeholder project.",
    body: "## Problem\n\nPlaceholder text.",
    stackTags: ["TypeScript", "PostgreSQL"],
    repoUrl: "https://example.com/placeholder",
    demoUrl: null,
  };
}

/**
 * Saves one owner revision of a project's locale with a fresh id.
 * @param project the project.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the title, to tell revisions apart.
 * @returns the new revision's id.
 */
export function saveProjectRevision(
  project: Project,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  return project.saveRevision(
    locale,
    projectDocument(project, locale, title),
    "owner",
    randomUUID(),
    at(minutes),
  ).id;
}

/** Every checklist box ticked. */
export const ALL_CHECKED: ApprovalChecklist = {
  noClientNames: true,
  noInternalNames: true,
  noNonPublicNumbers: true,
  noEmployerCode: true,
  ownVoice: true,
};

/**
 * A complete entry document.
 * @param title the title, to tell revisions apart.
 * @returns the document.
 */
export function entryDocument(title = "Placeholder entry"): KnowledgeEntryDocument {
  return {
    title,
    type: "feature",
    domain: "messaging",
    period: { from: "2025-01", to: null },
    role: "sole author",
    sections: [
      { key: "summary", body: "Placeholder summary." },
      { key: "problem", body: "Placeholder problem." },
      { key: "whatHeBuilt", body: "Placeholder work." },
    ],
    questions: ["What does the placeholder show?"],
    stack: ["TypeScript"],
    patterns: ["outbox"],
    related: [],
    cvBullet: "placeholder-1",
    indexable: true,
  };
}

/**
 * The private provenance of one entry revision.
 * @param note a source note, to tell revisions apart.
 * @returns the provenance.
 */
export function entryProvenance(note = "placeholder notes"): KnowledgeEntryProvenance {
  return { sources: [note], conflicts: "", publicNames: ["PostgreSQL"], confidence: "high" };
}

/**
 * A new entry with its first revision, in draft, never stored.
 * @returns the entry at version 0.
 */
export function newEntry(): KnowledgeEntry {
  return KnowledgeEntry.create({
    id: `kb-placeholder-${randomUUID().slice(0, 8)}`,
    document: entryDocument(),
    provenance: entryProvenance(),
    origin: "owner",
    revisionId: randomUUID(),
    at: at(),
  });
}
