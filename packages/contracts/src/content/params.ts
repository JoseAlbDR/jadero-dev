import { z } from "zod";
import { locale } from "./locale.js";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A URL slug: lowercase letters and digits in words joined by single hyphens (`portal-de-empleo`).
 * Localized slugs are unique per locale and type; canonical slugs are unique per type.
 */
export const slug = z.string().max(120).regex(KEBAB);

/** The kind of a project (ADR-011): a long case study, a regular project or an early one. */
export const projectKind = z.enum(["case_study", "project", "early"]);

/** `case_study`, `project` or `early`. */
export type ProjectKind = z.infer<typeof projectKind>;

/**
 * A knowledge entry id, the front-matter `id` of the entry file (ADR-031 alignment): `kb-` and a
 * kebab-case name, never reused (`kb-outbox-relay`).
 */
export const knowledgeEntryId = z
  .string()
  .max(120)
  .regex(/^kb-[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** A CV bullet id, human readable and stable (ADR-031 alignment): `backend-10`. */
export const cvBulletId = z.string().max(80).regex(KEBAB);

/** Where the next page of posts starts: the last row's publish time and id (keyset pagination). */
export const postCursorPosition = z.object({
  publishedAt: z.iso.datetime(),
  id: z.uuid(),
});

/** The decoded position of a post cursor. */
export type PostCursorPosition = z.infer<typeof postCursorPosition>;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function toBase64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
}

/**
 * Builds the opaque cursor a post page returns as `nextCursor`: base64url of the JSON pair
 * `[publishedAt, id]`. Clients pass it back unchanged and never read it.
 * @param position the publish time and id of the last post on the current page.
 * @returns the cursor string.
 */
export function encodePostCursor(position: PostCursorPosition): string {
  return toBase64Url(JSON.stringify([position.publishedAt, position.id]));
}

/**
 * The `cursor` query parameter of the post list: an opaque string that decodes into a position.
 * Anything that is not a cursor `encodePostCursor` could have built fails here with a 400, before
 * it reaches a query.
 */
export const postCursor = z
  .string()
  .max(200)
  .regex(BASE64URL)
  .transform((value, ctx) => {
    try {
      const [publishedAt, id] = JSON.parse(fromBase64Url(value)) as unknown[];
      const parsed = postCursorPosition.safeParse({ publishedAt, id });
      if (parsed.success) return parsed.data;
    } catch {
      // Not base64 or not JSON: reported below as one malformed-cursor issue.
    }
    ctx.addIssue({ code: "custom", message: "Malformed cursor" });
    return z.NEVER;
  });

/** Path parameters of a localized list or singleton: `/content/:locale/profile`. */
export const localeParams = z.object({ locale });

/** Path parameters of a localized item by its localized slug: `/content/:locale/projects/:slug`. */
export const localizedSlugParams = z.object({ locale, slug });

/** Query of the project list: `?kind=case_study` filters by kind; no kind lists them all. */
export const projectListQuery = z.object({ kind: projectKind.optional() });

/** Query of the post list: `?cursor=` continues after the page that returned it. */
export const postListQuery = z.object({ cursor: postCursor.optional() });

/** Path parameters of one approved knowledge entry: `/content/work/:entryId` (English only). */
export const knowledgeEntryParams = z.object({ entryId: knowledgeEntryId });
