import { randomUUID } from "node:crypto";
import type { ApprovalChecklist } from "../domain/approval-checklist.js";
import { CvBullet, type CvBulletParent } from "../domain/cv-bullet.js";
import { ExperienceItem } from "../domain/experience-item.js";
import {
  KnowledgeEntry,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
} from "../domain/knowledge-entry.js";
import type { Locale } from "../domain/locale.js";
import { Post } from "../domain/post.js";
import { Profile } from "../domain/profile.js";
import { Project, type ProjectDocument } from "../domain/project.js";
import { Skill } from "../domain/skill.js";

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

/**
 * A new profile with no revision, never stored.
 * @returns the profile at version 0.
 */
export function newProfile(): Profile {
  return Profile.create(randomUUID());
}

/**
 * Saves one complete owner revision of a profile's locale with a fresh id.
 * @param profile the profile.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the headline, to tell revisions apart.
 * @returns the new revision's id.
 */
export function saveProfileRevision(
  profile: Profile,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  const document = {
    name: "Placeholder Name",
    headline: `${title} (${locale})`,
    summary: "A placeholder summary.",
    links: [{ kind: "website" as const, url: "https://example.com/placeholder" }],
  };
  return profile.saveRevision(locale, document, "owner", randomUUID(), at(minutes)).id;
}

/**
 * A new experience item with no revision, never stored.
 * @returns the item at version 0.
 */
export function newExperienceItem(): ExperienceItem {
  return ExperienceItem.create({ id: randomUUID(), sortOrder: 2 });
}

/**
 * Saves one complete owner revision of an experience item's locale with a fresh id.
 * @param item the item.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the role, to tell revisions apart.
 * @returns the new revision's id.
 */
export function saveExperienceItemRevision(
  item: ExperienceItem,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  const document = {
    organization: "Placeholder Organization",
    role: `${title} (${locale})`,
    period: { from: "2024-01", to: null },
    locationType: "remote" as const,
    stackTags: ["TypeScript"],
  };
  return item.saveRevision(locale, document, "owner", randomUUID(), at(minutes)).id;
}

/**
 * A new post with no revision, never stored.
 * @returns the post at version 0.
 */
export function newPost(): Post {
  const id = randomUUID();
  return Post.create({ id, slug: `placeholder-${id.slice(0, 8)}` });
}

/**
 * Saves one complete owner revision of a post's locale with a fresh id; the localized slug carries
 * a piece of the id, because published slugs are unique per locale.
 * @param post the post.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the title, to tell revisions apart.
 * @returns the new revision's id.
 */
export function savePostRevision(
  post: Post,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  const document = {
    slug: `${locale}-placeholder-${post.id.slice(0, 8)}`,
    title: `${title} (${locale})`,
    excerpt: "A placeholder post.",
    body: "Placeholder text.",
    tags: ["placeholder"],
  };
  return post.saveRevision(locale, document, "owner", randomUUID(), at(minutes)).id;
}

/**
 * A new skill with no revision, never stored.
 * @returns the skill at version 0.
 */
export function newSkill(): Skill {
  return Skill.create({ id: randomUUID(), sortOrder: 3 });
}

/**
 * Saves one complete owner revision of a skill's locale with a fresh id.
 * @param skill the skill.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the name, to tell revisions apart.
 * @returns the new revision's id.
 */
export function saveSkillRevision(
  skill: Skill,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  const document = {
    name: `${title} (${locale})`,
    category: "Placeholder category",
    projectSlugs: ["placeholder-project"],
  };
  return skill.saveRevision(locale, document, "owner", randomUUID(), at(minutes)).id;
}

/**
 * A new CV bullet with no revision, never stored.
 * @param parent the experience item or project it details, fixed from now on.
 * @returns the bullet at version 0.
 */
export function newCvBullet(parent: CvBulletParent): CvBullet {
  return CvBullet.create({
    id: `placeholder-${randomUUID().slice(0, 8)}`,
    parent,
    sortOrder: 1,
    importance: 2,
  });
}

/**
 * Saves one complete owner revision of a CV bullet's locale with a fresh id.
 * @param bullet the bullet.
 * @param locale the locale.
 * @param minutes the save time, minutes after `at()`.
 * @param title the text, to tell revisions apart.
 * @returns the new revision's id.
 */
export function saveCvBulletRevision(
  bullet: CvBullet,
  locale: Locale,
  minutes = 0,
  title = "Placeholder",
): string {
  return bullet.saveRevision(
    locale,
    { text: `${title} (${locale})` },
    "owner",
    randomUUID(),
    at(minutes),
  ).id;
}
