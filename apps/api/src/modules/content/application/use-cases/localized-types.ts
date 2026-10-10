import { ItemNotFound } from "../../domain/content.errors.js";
import {
  CvBullet,
  type CvBulletDocument,
  type CvBulletImportance,
  type CvBulletParent,
} from "../../domain/cv-bullet.js";
import { ExperienceItem, type ExperienceItemDocument } from "../../domain/experience-item.js";
import type { Locale } from "../../domain/locale.js";
import type { PublishResult, PublishTarget } from "../../domain/localized-revisions.js";
import { Post, type PostDocument } from "../../domain/post.js";
import { Profile, type ProfileDocument } from "../../domain/profile.js";
import { Project, type ProjectDocument, type ProjectKind } from "../../domain/project.js";
import type { Revision, RevisionOrigin } from "../../domain/revision.js";
import { Skill, type SkillDocument } from "../../domain/skill.js";
import type { ContentScope } from "../content.unit-of-work.js";
import type { IdGenerator } from "../id-generator.js";

// The lookup table behind the generic use cases (owner decision, granularity B): one use case per
// operation, and per localized type one entry here that knows its repository in the scope and how
// to build a new aggregate. The table is a mapped type, so `LOCALIZED[command.type]` has the entry
// of exactly that type (TypeScript's "correlated union" pattern): no `any`, no cast.

/** The content types that publish per locale through `LocalizedRevisions` (D4). */
export const LOCALIZED_TYPES = [
  "profile",
  "experience-item",
  "project",
  "post",
  "skill",
  "cv-bullet",
] as const;

/** One localized content type, the `type` of every command. */
export type LocalizedType = (typeof LOCALIZED_TYPES)[number];

/** The localized types that can be archived: every one but the profile, a singleton. */
export type ArchivableType = Exclude<LocalizedType, "profile">;

/** The document (one locale's content, Q1 B) of each localized type. */
export interface DocumentOf {
  readonly profile: ProfileDocument;
  readonly "experience-item": ExperienceItemDocument;
  readonly project: ProjectDocument;
  readonly post: PostDocument;
  readonly skill: SkillDocument;
  readonly "cv-bullet": CvBulletDocument;
}

/**
 * The fields that create an item of each type, besides `type`: its layout (Q1 B). An omitted `id`
 * comes from the `IdGenerator` (UUIDv7); a CV bullet's id is the owner's human id, always given.
 */
export interface NewItemOf {
  readonly profile: { readonly id?: string | undefined };
  readonly "experience-item": { readonly id?: string | undefined; readonly sortOrder: number };
  readonly project: {
    readonly id?: string | undefined;
    readonly slug: string;
    readonly kind: ProjectKind;
    readonly featured: boolean;
    readonly sortOrder: number;
  };
  readonly post: { readonly id?: string | undefined; readonly slug: string };
  readonly skill: { readonly id?: string | undefined; readonly sortOrder: number };
  readonly "cv-bullet": {
    readonly id: string;
    readonly parent: CvBulletParent;
    readonly sortOrder: number;
    readonly importance: CvBulletImportance;
  };
}

/**
 * What the generic use cases need from an aggregate of any localized type; every aggregate class
 * has it structurally. `archive` is absent on the profile.
 */
export interface LocalizedItem<TDoc extends object> {
  readonly id: string;
  readonly version: number;
  saveRevision(
    locale: Locale,
    document: TDoc,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<TDoc>;
  publish(targets: readonly PublishTarget<TDoc>[], at: Date): PublishResult;
  archive?(at: Date): void;
}

/**
 * An aggregate loaded or created inside a unit of work, with the save of its own repository bound
 * to it, so the use case never has to know the concrete class to store it.
 */
export interface Tracked<TDoc extends object> {
  readonly item: LocalizedItem<TDoc>;
  /**
   * Stores the item through its type's scope repository (compare-and-set, D5).
   * @param expectedVersion the version the caller loaded, 0 for a new item.
   */
  save(expectedVersion: number): Promise<void>;
}

/** The entry of one localized type in the lookup table. */
export interface LocalizedTypeEntry<K extends LocalizedType> {
  /**
   * Builds a new aggregate at version 0; nothing is stored until `save(0)`.
   * @param scope the unit of work's repositories.
   * @param fields the create command's layout fields.
   * @param ids the id source for an omitted id.
   * @returns the new aggregate with its save bound.
   */
  create(scope: ContentScope, fields: NewItemOf[K], ids: IdGenerator): Tracked<DocumentOf[K]>;
  /**
   * Loads a stored aggregate.
   * @param scope the unit of work's repositories.
   * @param id the item's id; for the profile, the id of the stored singleton.
   * @returns the aggregate with its save bound, or undefined when not stored.
   */
  load(scope: ContentScope, id: string): Promise<Tracked<DocumentOf[K]> | undefined>;
  /**
   * Whether creating an item with this id would find one already stored. For the profile, any
   * stored profile counts, whatever its id: the singleton slot is taken.
   * @param scope the unit of work's repositories.
   * @param id the id a create would use.
   * @returns true when the item (or the profile) exists.
   */
  exists(scope: ContentScope, id: string): Promise<boolean>;
}

/** Pairs an aggregate with its repository's save. */
function tracked<TDoc extends object, TItem extends LocalizedItem<TDoc>>(
  item: TItem,
  save: (item: TItem, expectedVersion: number) => Promise<void>,
): Tracked<TDoc> {
  return { item, save: (expectedVersion) => save(item, expectedVersion) };
}

/** The lookup table: one entry per localized type, keyed by the command's `type`. */
export const LOCALIZED: { readonly [K in LocalizedType]: LocalizedTypeEntry<K> } = {
  profile: {
    create: (scope, fields, ids) =>
      tracked(Profile.create(fields.id ?? ids.next()), (p, v) => scope.profile.save(p, v)),
    load: async (scope, id) => {
      const profile = await scope.profile.find();
      if (!profile || profile.id !== id) return undefined;
      return tracked(profile, (p, v) => scope.profile.save(p, v));
    },
    exists: async (scope) => (await scope.profile.find()) !== undefined,
  },
  "experience-item": {
    create: (scope, fields, ids) =>
      tracked(
        ExperienceItem.create({ id: fields.id ?? ids.next(), sortOrder: fields.sortOrder }),
        (item, v) => scope.experienceItems.save(item, v),
      ),
    load: async (scope, id) => {
      const item = await scope.experienceItems.get(id);
      return item && tracked(item, (i, v) => scope.experienceItems.save(i, v));
    },
    exists: async (scope, id) => (await scope.experienceItems.get(id)) !== undefined,
  },
  project: {
    create: (scope, fields, ids) =>
      tracked(
        Project.create({
          id: fields.id ?? ids.next(),
          slug: fields.slug,
          kind: fields.kind,
          featured: fields.featured,
          sortOrder: fields.sortOrder,
        }),
        (project, v) => scope.projects.save(project, v),
      ),
    load: async (scope, id) => {
      const project = await scope.projects.get(id);
      return project && tracked(project, (p, v) => scope.projects.save(p, v));
    },
    exists: async (scope, id) => (await scope.projects.get(id)) !== undefined,
  },
  post: {
    create: (scope, fields, ids) =>
      tracked(Post.create({ id: fields.id ?? ids.next(), slug: fields.slug }), (post, v) =>
        scope.posts.save(post, v),
      ),
    load: async (scope, id) => {
      const post = await scope.posts.get(id);
      return post && tracked(post, (p, v) => scope.posts.save(p, v));
    },
    exists: async (scope, id) => (await scope.posts.get(id)) !== undefined,
  },
  skill: {
    create: (scope, fields, ids) =>
      tracked(
        Skill.create({ id: fields.id ?? ids.next(), sortOrder: fields.sortOrder }),
        (skill, v) => scope.skills.save(skill, v),
      ),
    load: async (scope, id) => {
      const skill = await scope.skills.get(id);
      return skill && tracked(skill, (s, v) => scope.skills.save(s, v));
    },
    exists: async (scope, id) => (await scope.skills.get(id)) !== undefined,
  },
  "cv-bullet": {
    create: (scope, fields) =>
      tracked(
        CvBullet.create({
          id: fields.id,
          parent: fields.parent,
          sortOrder: fields.sortOrder,
          importance: fields.importance,
        }),
        (bullet, v) => scope.cvBullets.save(bullet, v),
      ),
    load: async (scope, id) => {
      const bullet = await scope.cvBullets.get(id);
      return bullet && tracked(bullet, (b, v) => scope.cvBullets.save(b, v));
    },
    exists: async (scope, id) => (await scope.cvBullets.get(id)) !== undefined,
  },
};

/**
 * Loads a stored item of a localized type or fails.
 * @param scope the unit of work's repositories.
 * @param type the item's type.
 * @param id the item's id.
 * @returns the aggregate with its save bound.
 * @throws {ItemNotFound} when no item of that type has the id.
 */
export async function loadLocalized<K extends LocalizedType>(
  scope: ContentScope,
  type: K,
  id: string,
): Promise<Tracked<DocumentOf[K]>> {
  const found = await LOCALIZED[type].load(scope, id);
  if (!found) throw new ItemNotFound(type, id);
  return found;
}
