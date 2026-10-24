import {
  type ExperienceListDto,
  experienceListDto,
  type KnowledgeEntryDto,
  type KnowledgeEntryListDto,
  knowledgeEntryDto,
  knowledgeEntryId,
  knowledgeEntryListDto,
  type Locale,
  type NowDto,
  nowDto,
  type PostDto,
  type PostKind,
  type PostPageDto,
  type ProfileDto,
  type ProjectDto,
  type ProjectKind,
  type ProjectListDto,
  postDto,
  postPageDto,
  profileDto,
  projectDto,
  projectListDto,
  type SkillListDto,
  skillListDto,
  slug,
} from "@jadero/contracts";
import { notFound } from "next/navigation";
import { z } from "zod";
import { contentApiDebug, contentApiUrl } from "@/config/site";

/*
 * Client of the public content API of `api` (`/v1/content`, WP-12), for Server Components only.
 * Every response is parsed with its contract schema from `@jadero/contracts` and cached by Next's
 * `fetch` cache for CONTENT_REVALIDATE_SECONDS under content tags, so a revalidation consumer
 * (WP-14) can drop it early with `revalidateTag`. A 404 problem becomes the page's 404. Any other
 * failure throws a ContentApiError that names the resource only: never the URL, the status line's
 * body or the payload, so nothing a visitor sent or the API returned reaches a log line. The one
 * exception is opt-in and development only: with `CONTENT_API_DEBUG=1` under `next dev`, each
 * request is logged to the server console with its URL and body (`logContentFetch`).
 */

/** Seconds a cached content response stays fresh; the same as the API's `max-age=60`. */
export const CONTENT_REVALIDATE_SECONDS = 60;

/**
 * The cache tags of the content responses. A list carries its type tag; an item carries its type
 * tag and its own tag. Item tags hold the slug without the locale: a slug shared by two locales,
 * or the German fallback to the English slug, is dropped together, which over-invalidates at worst.
 */
export const contentTags = {
  profile: "content:profile",
  experience: "content:experience",
  projects: "content:projects",
  posts: "content:posts",
  skills: "content:skills",
  work: "content:work",
  now: "content:now",
  /**
   * @param projectSlug the localized slug of the project.
   * @returns the tag of one project page.
   */
  project: (projectSlug: string) => `content:projects:${projectSlug}`,
  /**
   * @param postSlug the localized slug of the post.
   * @returns the tag of one post page.
   */
  post: (postSlug: string) => `content:posts:${postSlug}`,
  /**
   * @param entryId the knowledge entry id (`kb-...`).
   * @returns the tag of one work-log page.
   */
  workEntry: (entryId: string) => `content:work:${entryId}`,
} as const;

/**
 * The content API failed in a way a page cannot show as a 404: unreachable, an unexpected status
 * or a payload its contract refuses. The message names the resource only.
 */
export class ContentApiError extends Error {
  override readonly name = "ContentApiError";

  /**
   * @param resource the resource asked for, for example `project`.
   * @param status the HTTP status, or `null` when no response arrived.
   * @param message what went wrong, without the URL or any body.
   */
  constructor(
    readonly resource: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** The part of an RFC 9457 problem a 404 needs: the API says the item is not there. */
const notFoundProblem = z.object({ status: z.literal(404), title: z.string() });

/**
 * True when a 404 response is the API's problem body, not a 404 from a wrong base URL or proxy,
 * which must surface as an error instead of a quiet "not found" page.
 */
function isNotFoundProblem(response: Response, body: unknown): boolean {
  if (!response.headers.get("content-type")?.includes("application/problem+json")) return false;
  return notFoundProblem.safeParse(body).success;
}

/** A response body read once: parsed when it is JSON, and the raw text for the debug log. */
type ResponseBody = Readonly<{ json: unknown; raw: string }>;

/** Reads a response body once; `json` is `undefined` when the body is empty or not JSON. */
async function readBody(response: Response): Promise<ResponseBody> {
  const raw = await response.text().catch(() => "");
  try {
    return { json: JSON.parse(raw), raw };
  } catch {
    return { json: undefined, raw };
  }
}

/** One content request as the development log shows it. */
type FetchLogEntry = Readonly<{
  url: string;
  /** The HTTP status, or `null` when no response arrived. */
  status: number | null;
  /** `performance.now()` when the request started. */
  started: number;
  /** The response's `Cache-Control`; on a hit of Next's fetch cache it is the stored one. */
  cacheControl: string | null;
  /** What follows the status line: the parsed body, a problem body or the contract's issues. */
  label: "body" | "problem" | "invalid payload" | "unreachable";
  detail: unknown;
}>;

/**
 * Logs one content request to the server console: method, full URL, status, duration and cache
 * hint on one line, then the detail pretty-printed. Does nothing unless `contentApiDebug()` is on
 * (`CONTENT_API_DEBUG=1` under `next dev`), so a production server never logs a URL or a body.
 * Next's own fetch log (`logging.fetches` in `next.config.ts`) adds the hit or miss of its cache.
 * @param entry the request and what to show after its status line.
 */
function logContentFetch(entry: FetchLogEntry): void {
  if (!contentApiDebug()) return;
  const duration = Math.round(performance.now() - entry.started);
  const cache = entry.cacheControl ? ` cache-control="${entry.cacheControl}"` : "";
  const detail =
    typeof entry.detail === "string"
      ? entry.detail
      : (JSON.stringify(entry.detail, null, 2) ?? "(empty)");
  console.info(
    `[content-api] GET ${entry.url} ${entry.status ?? "unreachable"} in ${duration}ms${cache}\n` +
      `${entry.label}: ${detail}`,
  );
}

/** The cause of a failed `fetch`, for the development log only (it names the host and port). */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * Fetches one content resource, caches it under its tags and parses it with its contract.
 * @param resource the resource name used in errors.
 * @param path the path under the base URL, already encoded.
 * @param schema the contract schema of the response.
 * @param tags the cache tags of the response.
 * @returns the parsed response, or `null` when the API answers with its 404 problem.
 */
async function fetchContent<S extends z.ZodType>(
  resource: string,
  path: string,
  schema: S,
  tags: string[],
): Promise<z.output<S> | null> {
  const url = `${contentApiUrl()}${path}`;
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: CONTENT_REVALIDATE_SECONDS, tags },
    });
  } catch (error) {
    logContentFetch({
      url,
      status: null,
      started,
      cacheControl: null,
      label: "unreachable",
      detail: describeFetchError(error),
    });
    // The cause names the host and port of the API; it stays out of the error on purpose.
    throw new ContentApiError(resource, null, `Content API unreachable for ${resource}`);
  }
  const body = await readBody(response);
  const log = (label: FetchLogEntry["label"], detail: unknown) =>
    logContentFetch({
      url,
      status: response.status,
      started,
      cacheControl: response.headers.get("cache-control"),
      label,
      detail,
    });
  if (response.status === 404 && isNotFoundProblem(response, body.json)) {
    log("problem", body.json);
    return null;
  }
  if (!response.ok) {
    log("problem", body.json ?? body.raw);
    throw new ContentApiError(
      resource,
      response.status,
      `Content API answered ${response.status} for ${resource}`,
    );
  }
  const parsed = schema.safeParse(body.json);
  if (!parsed.success) {
    log("invalid payload", parsed.error.issues);
    throw new ContentApiError(
      resource,
      response.status,
      `Content API returned an invalid ${resource} payload`,
    );
  }
  log("body", parsed.data);
  return parsed.data;
}

/**
 * Like `fetchContent`, but the API's 404 problem becomes the page's 404 (`notFound()`).
 * @param resource the resource name used in errors.
 * @param path the path under the base URL, already encoded.
 * @param schema the contract schema of the response.
 * @param tags the cache tags of the response.
 * @returns the parsed response.
 */
async function getContent<S extends z.ZodType>(
  resource: string,
  path: string,
  schema: S,
  tags: string[],
): Promise<z.output<S>> {
  return (await fetchContent(resource, path, schema, tags)) ?? notFound();
}

/**
 * Checks a slug or id from the visitor's URL against its contract before any request: a value the
 * API would refuse with a 400 is a page that does not exist.
 */
function requireParam<S extends z.ZodType<string>>(schema: S, value: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) notFound();
  return encodeURIComponent(parsed.data);
}

/**
 * `GET /v1/content/:locale/profile`: the owner's published profile.
 * @param locale the page locale.
 * @returns the profile; a German page may get the English text (German fallback).
 */
export async function getProfile(locale: Locale): Promise<ProfileDto> {
  return getContent("profile", `/v1/content/${locale}/profile`, profileDto, [contentTags.profile]);
}

/**
 * `GET /v1/content/:locale/experience`: every published experience item with its CV bullets.
 * @param locale the page locale.
 * @returns the items in display order.
 */
export async function getExperience(locale: Locale): Promise<ExperienceListDto> {
  return getContent("experience", `/v1/content/${locale}/experience`, experienceListDto, [
    contentTags.experience,
  ]);
}

/**
 * `GET /v1/content/:locale/projects?kind=`: the published projects.
 * @param locale the page locale.
 * @param kind only projects of this kind (`case_study`, `project`, `early`); all when absent.
 * @returns the projects in display order.
 */
export async function getProjects(locale: Locale, kind?: ProjectKind): Promise<ProjectListDto> {
  const query = kind ? `?kind=${kind}` : "";
  return getContent("projects", `/v1/content/${locale}/projects${query}`, projectListDto, [
    contentTags.projects,
  ]);
}

/**
 * `GET /v1/content/:locale/projects/:slug`: one published project.
 * @param locale the page locale.
 * @param projectSlug the localized slug from the page URL.
 * @returns the project; calls `notFound()` when it is not published or the slug is malformed.
 */
export async function getProject(locale: Locale, projectSlug: string): Promise<ProjectDto> {
  const segment = requireParam(slug, projectSlug);
  return getContent("project", `/v1/content/${locale}/projects/${segment}`, projectDto, [
    contentTags.projects,
    contentTags.project(projectSlug),
  ]);
}

/**
 * `GET /v1/content/:locale/posts?kind=&cursor=`: one page of published posts of one kind, newest
 * first. The kind is always sent, so the blog asks for `post` and the journal for `journal`
 * explicitly instead of the blog leaning on the API's default.
 * @param locale the page locale.
 * @param kind `post` for the blog, `journal` for the journal (ADR-034).
 * @param cursor the `nextCursor` of the previous page, or a visitor's cursor already checked and
 *   rebuilt by `postCursorParam`; the first page when absent.
 * @returns the page and the cursor of the next one.
 */
export async function getPosts(
  locale: Locale,
  kind: PostKind,
  cursor?: string,
): Promise<PostPageDto> {
  const query = new URLSearchParams({ kind });
  if (cursor) query.set("cursor", cursor);
  return getContent("posts", `/v1/content/${locale}/posts?${query}`, postPageDto, [
    contentTags.posts,
  ]);
}

/**
 * `GET /v1/content/:locale/posts/:slug`: one published post.
 * @param locale the page locale.
 * @param postSlug the localized slug from the page URL.
 * @returns the post; calls `notFound()` when it is not published or the slug is malformed.
 */
export async function getPost(locale: Locale, postSlug: string): Promise<PostDto> {
  return (await findPost(locale, postSlug)) ?? notFound();
}

/**
 * `GET /v1/content/:locale/posts/:slug` without the 404 page: a post page asks for its own slug
 * first and looks for another locale's slug only when the API does not know this one.
 * @param locale the page locale.
 * @param postSlug the localized slug from the page URL.
 * @returns the post, or `null` when no post is published with that slug in the locale; calls
 *   `notFound()` when the slug is malformed.
 */
export async function findPost(locale: Locale, postSlug: string): Promise<PostDto | null> {
  const segment = requireParam(slug, postSlug);
  return fetchContent("post", `/v1/content/${locale}/posts/${segment}`, postDto, [
    contentTags.posts,
    contentTags.post(postSlug),
  ]);
}

/**
 * `GET /v1/content/:locale/now`: the owner's published /now text (WP-39 D2), a singleton.
 * Unlike the other singletons, its 404 is not the page's 404: the /now page still shows the
 * journal blocks and a short note when no text is published in the locale.
 * @param locale the page locale.
 * @returns the text; a German page may get the English one (German fallback); `null` when nothing
 *   is published in the locale.
 */
export async function getNow(locale: Locale): Promise<NowDto | null> {
  return fetchContent("now", `/v1/content/${locale}/now`, nowDto, [contentTags.now]);
}

/**
 * `GET /v1/content/:locale/skills`: every published skill.
 * @param locale the page locale.
 * @returns the skills in display order.
 */
export async function getSkills(locale: Locale): Promise<SkillListDto> {
  return getContent("skills", `/v1/content/${locale}/skills`, skillListDto, [contentTags.skills]);
}

/**
 * `GET /v1/content/work`: every approved knowledge entry (English only, so no locale).
 * @returns the work-log entries.
 */
export async function getWorkLog(): Promise<KnowledgeEntryListDto> {
  return getContent("work log", "/v1/content/work", knowledgeEntryListDto, [contentTags.work]);
}

/**
 * `GET /v1/content/work/:entryId`: the approved revision of one knowledge entry.
 * @param entryId the entry id from the page URL (`kb-...`).
 * @returns the entry; calls `notFound()` when it is not approved or the id is malformed.
 */
export async function getWorkEntry(entryId: string): Promise<KnowledgeEntryDto> {
  const segment = requireParam(knowledgeEntryId, entryId);
  return getContent("work entry", `/v1/content/work/${segment}`, knowledgeEntryDto, [
    contentTags.work,
    contentTags.workEntry(entryId),
  ]);
}
