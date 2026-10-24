import { z } from "zod";
import { cvBulletDto, experienceItemDto } from "../content/experience.js";
import { locale } from "../content/locale.js";
import { nowDto } from "../content/now.js";
import { cvBulletId, postKind, projectKind, slug } from "../content/params.js";
import { postDto } from "../content/posts.js";
import { profileDto } from "../content/profile.js";
import { projectDto } from "../content/projects.js";
import { skillDto } from "../content/skills.js";
import { defineEvent } from "../define-event.js";

/** The revision a content event is about: its UUIDv7 id and its number, which orders versions. */
export const revisionRef = z.object({
  id: z.uuid(),
  number: z.int().min(1),
});

/** The fields every `content.published.v1` carries, whatever the aggregate. */
const published = {
  locale,
  revision: revisionRef,
  publishedAt: z.iso.datetime({ offset: true }),
};

/** What a CV bullet details: one experience item or one project, by id. */
const cvBulletParent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("experience-item"), experienceItemId: z.uuid() }),
  z.object({ kind: z.literal("project"), projectId: z.uuid() }),
]);

/**
 * `content.published.v1`: one locale of one content item became public at one revision (ADR-011),
 * written in the publish transaction through the outbox (WP-14 D1). One event per locale whose
 * published pointer moved; a publish that moved nothing writes none.
 *
 * Event-carried state transfer (WP-14 D2): `item` holds the item's fields that do not depend on the
 * locale (its base row: canonical slug, kind, sort order and the like) and `document` the published
 * text of this locale, so a read model needs no call back to `api`. Each document is a pick of the
 * public read schema of the same type, so the event and `GET /v1/content` cannot drift apart and an
 * event never carries a field the public API does not show. `revision.number` orders versions: a
 * consumer that already holds a higher number for the same `aggregate`, `id` and `locale` ignores
 * an older event, since delivery order is not promised.
 */
export const contentPublishedV1 = defineEvent(
  "content.published.v1",
  z.discriminatedUnion("aggregate", [
    z.object({
      aggregate: z.literal("profile"),
      id: z.uuid(),
      ...published,
      item: z.object({}),
      document: profileDto.pick({ name: true, headline: true, summary: true, links: true }),
    }),
    z.object({
      aggregate: z.literal("now"),
      id: z.uuid(),
      ...published,
      item: z.object({}),
      document: nowDto.pick({ body: true }),
    }),
    z.object({
      aggregate: z.literal("experience-item"),
      id: z.uuid(),
      ...published,
      item: z.object({ sortOrder: z.int() }),
      document: experienceItemDto.pick({
        organization: true,
        role: true,
        period: true,
        locationType: true,
        stackTags: true,
      }),
    }),
    z.object({
      aggregate: z.literal("project"),
      id: z.uuid(),
      ...published,
      item: z.object({
        slug,
        kind: projectKind,
        featured: z.boolean(),
        sortOrder: z.int(),
      }),
      document: projectDto.pick({
        slug: true,
        title: true,
        summary: true,
        body: true,
        stackTags: true,
        repoUrl: true,
        demoUrl: true,
      }),
    }),
    z.object({
      aggregate: z.literal("post"),
      id: z.uuid(),
      ...published,
      item: z.object({ slug, kind: postKind, wp: z.int().min(1).nullable() }),
      document: postDto.pick({ slug: true, title: true, excerpt: true, body: true, tags: true }),
    }),
    z.object({
      aggregate: z.literal("skill"),
      id: z.uuid(),
      ...published,
      item: z.object({ sortOrder: z.int() }),
      document: skillDto.pick({ name: true, category: true, projectSlugs: true }),
    }),
    z.object({
      aggregate: z.literal("cv-bullet"),
      id: cvBulletId,
      ...published,
      item: z.object({
        parent: cvBulletParent,
        sortOrder: z.int(),
        importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }),
      document: cvBulletDto.pick({ text: true }),
    }),
  ]),
);
