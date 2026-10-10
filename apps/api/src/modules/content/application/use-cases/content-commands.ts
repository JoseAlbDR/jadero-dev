import { z } from "zod";
import type { Locale } from "../../domain/locale.js";
import {
  cvBulletDocumentSchema,
  cvBulletImportanceSchema,
  cvBulletParentSchema,
  experienceItemDocumentSchema,
  localeSchema,
  postDocumentSchema,
  profileDocumentSchema,
  projectDocumentSchema,
  projectKindSchema,
  skillDocumentSchema,
} from "../content-documents.js";
import type { ArchivableType, DocumentOf, LocalizedType, NewItemOf } from "./localized-types.js";

// The commands of the generic content use cases, each a Zod discriminated union on `type`: the
// use case parses its command before anything runs (Zod at every boundary), and the parse keeps
// `type` and the document in step, which is what lets the generic code trust `LOCALIZED[type]`.
// Each schema is annotated with its TypeScript union, so the two cannot drift apart.

/** Creates an item of type `K` with no revision. */
export type CreateContentItemCommandOf<K extends LocalizedType> = {
  readonly type: K;
} & NewItemOf[K];

/** Creates an item of any localized type. */
export type CreateContentItemCommand = {
  [K in LocalizedType]: CreateContentItemCommandOf<K>;
}[LocalizedType];

/** Saves a new revision of one locale of an item of type `K`. */
export interface SaveContentRevisionCommandOf<K extends LocalizedType> {
  readonly type: K;
  readonly id: string;
  readonly locale: Locale;
  readonly document: DocumentOf[K];
  /** The version the caller loaded (D5). */
  readonly expectedVersion: number;
}

/** Saves a revision of an item of any localized type. */
export type SaveContentRevisionCommand = {
  [K in LocalizedType]: SaveContentRevisionCommandOf<K>;
}[LocalizedType];

/** Publishes the latest revision of the named locales of an item of type `K`. */
export interface PublishContentItemCommandOf<K extends LocalizedType> {
  readonly type: K;
  readonly id: string;
  readonly locales: readonly Locale[];
  readonly expectedVersion: number;
}

/** Publishes an item of any localized type. */
export type PublishContentItemCommand = {
  [K in LocalizedType]: PublishContentItemCommandOf<K>;
}[LocalizedType];

/** Archives an item of type `K`, hiding every locale. */
export interface ArchiveContentItemCommandOf<K extends ArchivableType> {
  readonly type: K;
  readonly id: string;
  readonly expectedVersion: number;
}

/** Archives an item of any type but the profile. */
export type ArchiveContentItemCommand = {
  [K in ArchivableType]: ArchiveContentItemCommandOf<K>;
}[ArchivableType];

const documentSchemas = {
  profile: profileDocumentSchema,
  "experience-item": experienceItemDocumentSchema,
  project: projectDocumentSchema,
  post: postDocumentSchema,
  skill: skillDocumentSchema,
  "cv-bullet": cvBulletDocumentSchema,
} as const satisfies { readonly [K in LocalizedType]: z.ZodType<DocumentOf[K]> };

/**
 * The id format of each type: UUIDs for the types whose ids come from the `IdGenerator` (a malformed
 * one would reach a `uuid` column and fail in Postgres instead of as not found), the owner's human
 * id for CV bullets, whose format the domain checks on create.
 */
const uuidId = z.uuid();
const bulletId = z.string().min(1).max(80);

/** A version an existing item can be at: the first save stores 1. */
const expectedVersion = z.int().min(1);

const sortOrder = z.int();

const layoutFields = {
  profile: {},
  "experience-item": { sortOrder },
  project: {
    slug: z.string(),
    kind: projectKindSchema,
    featured: z.boolean(),
    sortOrder,
  },
  post: { slug: z.string() },
  skill: { sortOrder },
  "cv-bullet": { parent: cvBulletParentSchema, sortOrder, importance: cvBulletImportanceSchema },
} as const;

/** Validates `CreateContentItemCommand`. */
export const createContentItemCommand: z.ZodType<CreateContentItemCommand> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("profile"), id: uuidId.optional(), ...layoutFields.profile }),
    z.object({
      type: z.literal("experience-item"),
      id: uuidId.optional(),
      ...layoutFields["experience-item"],
    }),
    z.object({ type: z.literal("project"), id: uuidId.optional(), ...layoutFields.project }),
    z.object({ type: z.literal("post"), id: uuidId.optional(), ...layoutFields.post }),
    z.object({ type: z.literal("skill"), id: uuidId.optional(), ...layoutFields.skill }),
    z.object({ type: z.literal("cv-bullet"), id: bulletId, ...layoutFields["cv-bullet"] }),
  ],
);

function saveMember<K extends LocalizedType>(type: K, id: z.ZodType<string>) {
  return z.object({
    type: z.literal(type),
    id,
    locale: localeSchema,
    document: documentSchemas[type],
    expectedVersion,
  });
}

/** Validates `SaveContentRevisionCommand`. */
export const saveContentRevisionCommand: z.ZodType<SaveContentRevisionCommand> =
  z.discriminatedUnion("type", [
    saveMember("profile", uuidId),
    saveMember("experience-item", uuidId),
    saveMember("project", uuidId),
    saveMember("post", uuidId),
    saveMember("skill", uuidId),
    saveMember("cv-bullet", bulletId),
  ]);

function publishMember<K extends LocalizedType>(type: K, id: z.ZodType<string>) {
  return z.object({
    type: z.literal(type),
    id,
    locales: z.array(localeSchema).min(1),
    expectedVersion,
  });
}

/** Validates `PublishContentItemCommand`. */
export const publishContentItemCommand: z.ZodType<PublishContentItemCommand> = z.discriminatedUnion(
  "type",
  [
    publishMember("profile", uuidId),
    publishMember("experience-item", uuidId),
    publishMember("project", uuidId),
    publishMember("post", uuidId),
    publishMember("skill", uuidId),
    publishMember("cv-bullet", bulletId),
  ],
);

function archiveMember<K extends ArchivableType>(type: K, id: z.ZodType<string>) {
  return z.object({ type: z.literal(type), id, expectedVersion });
}

/** Validates `ArchiveContentItemCommand`; the profile is not a member, so it cannot be archived. */
export const archiveContentItemCommand: z.ZodType<ArchiveContentItemCommand> = z.discriminatedUnion(
  "type",
  [
    archiveMember("experience-item", uuidId),
    archiveMember("project", uuidId),
    archiveMember("post", uuidId),
    archiveMember("skill", uuidId),
    archiveMember("cv-bullet", bulletId),
  ],
);

/** The schemas the seed reuses for its items. */
export const seedSchemaParts = { documentSchemas, layoutFields, uuidId, bulletId } as const;
