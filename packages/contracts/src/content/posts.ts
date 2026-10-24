import { z } from "zod";
import { locale } from "./locale.js";
import { postKind, slug } from "./params.js";
import { alternates, publishedText, tags } from "./shared.js";

/**
 * One post in a list: what a card needs, without the body. `kind` and `wp` arrived with the journal
 * (ADR-034): a journal post names its work package, a blog post has `wp: null`. Both default on
 * parse, so a reader on this contract still accepts a response from an `api` that predates them
 * (expand first).
 */
export const postSummaryDto = z.object({
  slug,
  locale,
  kind: postKind.default("post"),
  wp: z.int().min(1).nullable().default(null),
  title: publishedText,
  excerpt: z.string(),
  tags,
  publishedAt: z.iso.datetime(),
  alternates,
});

/** A post card. */
export type PostSummaryDto = z.infer<typeof postSummaryDto>;

/**
 * `GET /content/:locale/posts?kind=&cursor=`: one page of published posts, newest first. `nextCursor` is
 * the opaque cursor of the next page, `null` on the last one.
 */
export const postPageDto = z.object({
  items: z.array(postSummaryDto),
  nextCursor: z.string().nullable(),
});

/** A page of post cards. */
export type PostPageDto = z.infer<typeof postPageDto>;

/** `GET /content/:locale/posts/:slug`: one published post; `body` is raw Markdown (ADR-011). */
export const postDto = postSummaryDto.extend({ body: publishedText });

/** A public post page. */
export type PostDto = z.infer<typeof postDto>;
