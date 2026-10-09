import { z } from "zod";
import { locale } from "./locale.js";
import { cvBulletId, knowledgeEntryId } from "./params.js";
import { period, publishedText, tags } from "./shared.js";

/**
 * One published CV bullet (ADR-031 Layer A), in its parent's language. `entryIds` are the approved
 * knowledge entries whose `cvBullet` names this bullet: the reverse lookup, possibly empty. The
 * "Ask about this" action sends `id`.
 */
export const cvBulletDto = z.object({
  id: cvBulletId,
  text: z.string().min(1),
  entryIds: z.array(knowledgeEntryId),
});

/** A public CV bullet. */
export type CvBulletDto = z.infer<typeof cvBulletDto>;

/** Where the work happened. */
export const locationType = z.enum(["remote", "hybrid", "onsite"]);

/**
 * One published experience item with its published CV bullets in display order. `organization` is
 * the public name only. `locale` may be `en` on a German request (German fallback).
 */
export const experienceItemDto = z.object({
  locale,
  organization: publishedText,
  role: publishedText,
  period,
  locationType,
  stackTags: tags,
  bullets: z.array(cvBulletDto),
});

/** A public experience item. */
export type ExperienceItemDto = z.infer<typeof experienceItemDto>;

/** `GET /content/:locale/experience`: every published item, in display order. */
export const experienceListDto = z.object({ items: z.array(experienceItemDto) });

/** The public experience list. */
export type ExperienceListDto = z.infer<typeof experienceListDto>;
