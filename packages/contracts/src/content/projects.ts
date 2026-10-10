import { z } from "zod";
import { locale } from "./locale.js";
import { projectKind, slug } from "./params.js";
import { alternates, httpsUrl, publishedText, tags } from "./shared.js";

/**
 * One project in a list: what a card needs, without the body. `slug` is the localized slug of the
 * returned `locale`, which is `en` on a German request when German is not published.
 */
export const projectSummaryDto = z.object({
  slug,
  locale,
  kind: projectKind,
  title: publishedText,
  summary: z.string(),
  stackTags: tags,
  featured: z.boolean(),
  alternates,
});

/** A project card. */
export type ProjectSummaryDto = z.infer<typeof projectSummaryDto>;

/** `GET /content/:locale/projects?kind=`: published projects in display order. */
export const projectListDto = z.object({ items: z.array(projectSummaryDto) });

/** The public project list. */
export type ProjectListDto = z.infer<typeof projectListDto>;

/**
 * `GET /content/:locale/projects/:slug`: one published project. `body` is Markdown, returned raw
 * (ADR-011); `web` renders it with `rehype-sanitize`.
 */
export const projectDto = projectSummaryDto.extend({
  body: publishedText,
  repoUrl: httpsUrl.nullable(),
  demoUrl: httpsUrl.nullable(),
});

/** A public project page. */
export type ProjectDto = z.infer<typeof projectDto>;
