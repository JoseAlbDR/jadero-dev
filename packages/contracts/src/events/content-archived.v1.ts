import { z } from "zod";
import { cvBulletId } from "../content/params.js";
import { alternates } from "../content/shared.js";
import { defineEvent } from "../define-event.js";

const archived = { archivedAt: z.iso.datetime({ offset: true }) };

/**
 * The localized slug each locale was published under when the item was archived; a locale never
 * published is absent. `web` tags an item page by its localized slug, so these name the pages to
 * drop.
 */
const publishedSlugs = alternates;

/**
 * `content.archived.v1`: a tombstone, one content item left every public read at once (WP-14 Q2 A),
 * written in the archive transaction through the outbox. It carries no document: a read model
 * deletes what it holds for `aggregate` and `id` in every locale. Projects and posts also carry
 * `slugs`, the published localized slugs, so the revalidation consumer can name their pages. The
 * singletons (`profile`, `now`) cannot be archived, so they have no member here.
 */
export const contentArchivedV1 = defineEvent(
  "content.archived.v1",
  z.discriminatedUnion("aggregate", [
    z.object({ aggregate: z.literal("experience-item"), id: z.uuid(), ...archived }),
    z.object({
      aggregate: z.literal("project"),
      id: z.uuid(),
      ...archived,
      slugs: publishedSlugs,
    }),
    z.object({ aggregate: z.literal("post"), id: z.uuid(), ...archived, slugs: publishedSlugs }),
    z.object({ aggregate: z.literal("skill"), id: z.uuid(), ...archived }),
    z.object({ aggregate: z.literal("cv-bullet"), id: cvBulletId, ...archived }),
  ]),
);
