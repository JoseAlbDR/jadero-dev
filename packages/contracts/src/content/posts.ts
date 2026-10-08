import { z } from "zod";
import { locale } from "./locale.js";
import { slug } from "./params.js";
import { alternates, tags } from "./shared.js";

/** One post in a list: what a card needs, without the body. */
export const postSummaryDto = z.object({
  slug,
  locale,
  title: z.string().min(1),
  excerpt: z.string(),
  tags,
  publishedAt: z.iso.datetime(),
  alternates,
});

/** A post card. */
export type PostSummaryDto = z.infer<typeof postSummaryDto>;

/**
 * `GET /content/:locale/posts?cursor=`: one page of published posts, newest first. `nextCursor` is
 * the opaque cursor of the next page, `null` on the last one.
 */
export const postPageDto = z.object({
  items: z.array(postSummaryDto),
  nextCursor: z.string().nullable(),
});

/** A page of post cards. */
export type PostPageDto = z.infer<typeof postPageDto>;

/** `GET /content/:locale/posts/:slug`: one published post; `body` is raw Markdown (ADR-011). */
export const postDto = postSummaryDto.extend({ body: z.string() });

/** A public post page. */
export type PostDto = z.infer<typeof postDto>;
