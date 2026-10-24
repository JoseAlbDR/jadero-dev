/*
 * A stub of the public content API for the e2e suite, started by playwright.config.ts next to the
 * standalone server, so `pnpm test:e2e` never needs Docker, Postgres or `api`. It answers
 * `GET /v1/content/:locale/profile` from `profile.json`, `GET /v1/content/:locale/experience` from
 * `experience.json`, `GET /v1/content/:locale/projects`
 * (with `?kind=`) and `GET /v1/content/:locale/projects/:slug` from `projects.json`,
 * `GET /v1/content/:locale/posts` (with `?kind=` and `?cursor=`) and
 * `GET /v1/content/:locale/posts/:slug` from `posts.json` (kind `post`, the default) and
 * `journal.json` (kind `journal`; the item route serves both kinds, as the API does), `GET /v1/content/:locale/skills` from `skills.json`, `GET /v1/content/work` and
 * `GET /v1/content/work/:entryId` from `work.json` (English only, no locale), and a 404 problem
 * for anything else. The fixtures hold each locale's answer as the API gives it, the German fallback to English
 * included; posts are listed newest first. Every fixture is parsed with its `@jadero/contracts`
 * schema at start: a fixture that drifts from the contract stops the suite before a test runs.
 * Node runs this file directly (type stripping), so it holds only erasable TypeScript. It logs
 * nothing per request.
 */
import { createServer } from "node:http";
import {
  encodePostCursor,
  experienceListDto,
  knowledgeEntryDto,
  knowledgeEntryListDto,
  type Locale,
  locale,
  postCursor,
  postDto,
  postKind,
  postPageDto,
  profileDto,
  projectDto,
  projectKind,
  projectListDto,
  skillListDto,
} from "@jadero/contracts";
import { z } from "zod";
import experience from "./experience.json" with { type: "json" };
import journal from "./journal.json" with { type: "json" };
import posts from "./posts.json" with { type: "json" };
import profile from "./profile.json" with { type: "json" };
import projects from "./projects.json" with { type: "json" };
import skills from "./skills.json" with { type: "json" };
import work from "./work.json" with { type: "json" };

const profileFixtures = z.record(locale, profileDto).parse(profile);
const experienceFixtures = z.record(locale, experienceListDto).parse(experience);
const projectFixtures = z.record(locale, z.array(projectDto)).parse(projects);
const postFixtures = z.record(locale, z.array(postDto)).parse(posts);
const journalFixtures = z.record(locale, z.array(postDto)).parse(journal);
const fixturesByKind = { post: postFixtures, journal: journalFixtures } as const;
const skillFixtures = z.record(locale, skillListDto).parse(skills);
const workFixtures = z.array(knowledgeEntryDto).parse(work);

/**
 * Posts per page. The real API sends 20; the stub sends 2, so three fixture posts already need a
 * second page and the cursor links are exercised. The site never relies on the page size.
 */
const POSTS_PAGE_SIZE = 2;
const port = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.E2E_API_PORT ?? "3211");

const PROFILE_PATH = /^\/v1\/content\/(es|en|de)\/profile$/;
const EXPERIENCE_PATH = /^\/v1\/content\/(es|en|de)\/experience$/;
const PROJECTS_PATH = /^\/v1\/content\/(es|en|de)\/projects$/;
const PROJECT_PATH = /^\/v1\/content\/(es|en|de)\/projects\/([a-z0-9-]+)$/;
const POSTS_PATH = /^\/v1\/content\/(es|en|de)\/posts$/;
const POST_PATH = /^\/v1\/content\/(es|en|de)\/posts\/([a-z0-9-]+)$/;
const SKILLS_PATH = /^\/v1\/content\/(es|en|de)\/skills$/;
const WORK_ENTRY_PATH = /^\/v1\/content\/work\/(kb-[a-z0-9-]+)$/;

/** A stable post id for the cursor: the post's position in its locale's fixture list. */
const postId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/**
 * One page of a locale's posts of one kind after the cursor's position (keyset pagination, as the
 * API does). A cursor the API would refuse with a 400 gets `undefined`, so a 404 here; the site
 * checks every cursor before it forwards one, so neither status reaches a test.
 * @param fixtures the posts of one kind per locale.
 * @param postLocale the locale of the list.
 * @param cursor the raw `?cursor=` value, or `null` for the first page.
 */
function postPage(
  fixtures: Partial<Record<Locale, z.infer<typeof postDto>[]>>,
  postLocale: Locale,
  cursor: string | null,
): unknown {
  const items = fixtures[postLocale] ?? [];
  let start = 0;
  if (cursor !== null) {
    const position = postCursor.safeParse(cursor);
    if (!position.success) return undefined;
    start = items.findIndex((_, index) => postId(index) === position.data.id) + 1;
    if (start === 0) return undefined;
  }
  const page = items.slice(start, start + POSTS_PAGE_SIZE);
  const lastIndex = start + page.length - 1;
  const last = items[lastIndex];
  const more = lastIndex + 1 < items.length;
  return postPageDto.parse({
    items: page,
    nextCursor:
      more && last
        ? encodePostCursor({ publishedAt: last.publishedAt, id: postId(lastIndex) })
        : null,
  });
}

/**
 * The body the real API would send for a GET, or `undefined` for its 404.
 * @param url the request URL.
 */
function answer(url: URL): unknown {
  const path = url.pathname;
  const profileMatch = PROFILE_PATH.exec(path);
  if (profileMatch) return profileFixtures[locale.parse(profileMatch[1])];

  const experienceMatch = EXPERIENCE_PATH.exec(path);
  if (experienceMatch) return experienceFixtures[locale.parse(experienceMatch[1])];

  const listMatch = PROJECTS_PATH.exec(path);
  if (listMatch) {
    const query = projectKind.optional().safeParse(url.searchParams.get("kind") ?? undefined);
    if (!query.success) return undefined;
    const kind = query.data;
    const items = projectFixtures[locale.parse(listMatch[1])] ?? [];
    // The list carries summaries: the same parse the API's response schema would apply.
    return projectListDto.parse({ items: items.filter((p) => !kind || p.kind === kind) });
  }

  const itemMatch = PROJECT_PATH.exec(path);
  if (itemMatch) {
    const items = projectFixtures[locale.parse(itemMatch[1])] ?? [];
    return items.find((p) => p.slug === itemMatch[2]);
  }

  const postsMatch = POSTS_PATH.exec(path);
  if (postsMatch) {
    const kind = postKind.default("post").safeParse(url.searchParams.get("kind") ?? undefined);
    if (!kind.success) return undefined;
    const postLocale = locale.parse(postsMatch[1]);
    return postPage(fixturesByKind[kind.data], postLocale, url.searchParams.get("cursor"));
  }

  const postMatch = POST_PATH.exec(path);
  if (postMatch) {
    const postLocale = locale.parse(postMatch[1]);
    const items = [...(postFixtures[postLocale] ?? []), ...(journalFixtures[postLocale] ?? [])];
    return items.find((p) => p.slug === postMatch[2]);
  }

  const skillsMatch = SKILLS_PATH.exec(path);
  if (skillsMatch) return skillFixtures[locale.parse(skillsMatch[1])];

  if (path === "/v1/content/work") {
    // The list carries each entry's metadata and its Summary, as the API's list does.
    const items = workFixtures.map((entry) => ({
      ...entry,
      summary: entry.sections.find((s) => s.key === "summary")?.body,
    }));
    return knowledgeEntryListDto.parse({ items });
  }

  const workEntryMatch = WORK_ENTRY_PATH.exec(path);
  if (workEntryMatch) return workFixtures.find((entry) => entry.id === workEntryMatch[1]);
  return undefined;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://stub");
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  const body = request.method === "GET" ? answer(url) : undefined;
  if (body) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  response
    .writeHead(404, { "content-type": "application/problem+json" })
    .end(JSON.stringify({ type: "about:blank", title: "Not Found", status: 404 }));
});

server.listen(port, "127.0.0.1");
