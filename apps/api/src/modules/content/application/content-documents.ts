import { z } from "zod";
import { APPROVAL_CHECKS, type ApprovalChecklist } from "../domain/approval-checklist.js";
import type { CvBulletDocument, CvBulletImportance, CvBulletParent } from "../domain/cv-bullet.js";
import type { ExperienceItemDocument, LocationType } from "../domain/experience-item.js";
import {
  KNOWLEDGE_ENTRY_SECTION_KEYS,
  type KnowledgeEntryConfidence,
  type KnowledgeEntryDocument,
  type KnowledgeEntryProvenance,
  type KnowledgeEntryRole,
  type KnowledgeEntryType,
} from "../domain/knowledge-entry.js";
import { LOCALES, type Locale } from "../domain/locale.js";
import type { PostDocument } from "../domain/post.js";
import type { ProfileDocument, ProfileLinkKind } from "../domain/profile.js";
import type { ProjectDocument, ProjectKind } from "../domain/project.js";
import type { SkillDocument } from "../domain/skill.js";

// The structural Zod schemas of every content document (Q1 B), in one place for both boundaries
// that carry one: a use case parses its command with them (a document arriving from outside), and
// the repositories parse every stored `jsonb` document with them (the tolerant reader). Structure
// only: the format and completeness rules are the domain's, checked at save and at publish.

/**
 * The keys of a union as the tuple `z.enum` takes; a `satisfies Record<Union, true>` on the
 * argument makes each list complete, so a value added to the domain's union fails to compile here.
 * @param record one `true` per member of the union.
 * @returns the members.
 */
export function keysOf<T extends string>(record: Record<T, true>): [T, ...T[]] {
  return Object.keys(record) as [T, ...T[]];
}

/** `es`, `en` or `de`. */
export const localeSchema: z.ZodType<Locale> = z.enum(LOCALES);

const linkKinds = {
  email: true,
  github: true,
  linkedin: true,
  website: true,
} as const satisfies Record<ProfileLinkKind, true>;

/** One locale of the profile. */
export const profileDocumentSchema: z.ZodType<ProfileDocument> = z.object({
  name: z.string(),
  headline: z.string(),
  summary: z.string(),
  links: z.array(z.object({ kind: z.enum(keysOf(linkKinds)), url: z.string() })),
});

const locationTypes = {
  remote: true,
  hybrid: true,
  onsite: true,
} as const satisfies Record<LocationType, true>;

const periodSchema = z.object({ from: z.string(), to: z.string().nullable() });

/** One locale of an experience item. */
export const experienceItemDocumentSchema: z.ZodType<ExperienceItemDocument> = z.object({
  organization: z.string(),
  role: z.string(),
  period: periodSchema,
  locationType: z.enum(keysOf(locationTypes)),
  stackTags: z.array(z.string()),
});

/** One locale of a project. */
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

/** A project's kind, a layout field on the root. */
export const projectKindSchema: z.ZodType<ProjectKind> = z.enum(keysOf(projectKinds));

/** One locale of a post. */
export const postDocumentSchema: z.ZodType<PostDocument> = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
});

/** One locale of a skill. */
export const skillDocumentSchema: z.ZodType<SkillDocument> = z.object({
  name: z.string(),
  category: z.string(),
  projectSlugs: z.array(z.string()),
});

/** One locale of a CV bullet: the line itself. */
export const cvBulletDocumentSchema: z.ZodType<CvBulletDocument> = z.object({ text: z.string() });

/** A CV bullet's importance, 1 (most) to 3, a layout field on the root. */
export const cvBulletImportanceSchema: z.ZodType<CvBulletImportance> = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

/** What a CV bullet details: one experience item or one project, by id. */
export const cvBulletParentSchema: z.ZodType<CvBulletParent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("experience-item"), experienceItemId: z.uuid() }),
  z.object({ kind: z.literal("project"), projectId: z.uuid() }),
]);

const entryTypes = {
  feature: true,
  improvement: true,
  "tech-debt": true,
  integration: true,
  performance: true,
  tooling: true,
  workshop: true,
} as const satisfies Record<KnowledgeEntryType, true>;

const entryRoles = {
  "sole author": true,
  lead: true,
  contributor: true,
} as const satisfies Record<KnowledgeEntryRole, true>;

const confidences = {
  high: true,
  medium: true,
  low: true,
} as const satisfies Record<KnowledgeEntryConfidence, true>;

/** One revision of a knowledge entry: only the public fields; the provenance is separate. */
export const knowledgeEntryDocumentSchema: z.ZodType<KnowledgeEntryDocument> = z.object({
  title: z.string(),
  type: z.enum(keysOf(entryTypes)),
  domain: z.string(),
  period: periodSchema,
  role: z.enum(keysOf(entryRoles)),
  sections: z.array(z.object({ key: z.enum(KNOWLEDGE_ENTRY_SECTION_KEYS), body: z.string() })),
  questions: z.array(z.string()),
  stack: z.array(z.string()),
  patterns: z.array(z.string()),
  related: z.array(z.string()),
  cvBullet: z.string().nullable(),
  indexable: z.boolean(),
});

/** The private provenance of one entry revision (D-67), for the owner only. */
export const knowledgeEntryProvenanceSchema: z.ZodType<KnowledgeEntryProvenance> = z.object({
  sources: z.array(z.string()),
  conflicts: z.string(),
  publicNames: z.array(z.string()),
  confidence: z.enum(keysOf(confidences)),
});

/** The owner's answer to each of the five boxes of the approval checklist (ADR-031). */
export const approvalChecklistSchema: z.ZodType<ApprovalChecklist> = z.object({
  noClientNames: z.boolean(),
  noInternalNames: z.boolean(),
  noNonPublicNumbers: z.boolean(),
  noEmployerCode: z.boolean(),
  ownVoice: z.boolean(),
} satisfies Record<(typeof APPROVAL_CHECKS)[number], z.ZodBoolean>);
