import type { PostDto, PostKind } from "@jadero/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPostPage } from "../src/content/post-page";

const BASE = "http://api.internal:3001";

/** A published post of a kind, as `GET /v1/content/:locale/posts/:slug` returns it. */
function post(slug: string, kind: PostKind, alternates: PostDto["alternates"]): PostDto {
  return {
    slug,
    locale: "en",
    kind,
    wp: kind === "journal" ? 12 : null,
    title: slug,
    excerpt: "",
    tags: [],
    publishedAt: "2026-10-01T09:00:00.000Z",
    alternates,
    body: "Text.",
  };
}

const BLOG_POST = post("why-an-outbox", "post", { en: "why-an-outbox" });
const JOURNAL_POST = post("journal-wp-12", "journal", {
  en: "journal-wp-12",
  es: "diario-wp-12",
});

/** The fake API: one item per slug, and one list page per kind. */
const ITEMS: Record<string, PostDto> = {
  [BLOG_POST.slug]: BLOG_POST,
  [JOURNAL_POST.slug]: JOURNAL_POST,
};

function respond(url: string): Response {
  const { pathname, searchParams } = new URL(url);
  const item = /\/posts\/([a-z0-9-]+)$/.exec(pathname);
  if (item) {
    const found = ITEMS[item[1] ?? ""];
    return found
      ? Response.json(found)
      : new Response(JSON.stringify({ title: "Not Found", status: 404 }), {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        });
  }
  const kind = searchParams.get("kind");
  const items = Object.values(ITEMS).filter((p) => p.kind === kind);
  return Response.json({ items, nextCursor: null });
}

const fetchMock = vi.fn(async (url: string) => respond(url));

/** Asserts that `promise` rejects with the error `notFound()` throws. */
async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404/),
  });
}

beforeEach(() => {
  vi.stubEnv("CONTENT_API_URL", BASE);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("loadPostPage", () => {
  it("serves a post on its own kind's route", async () => {
    await expect(loadPostPage("en", "why-an-outbox", "post")).resolves.toEqual(BLOG_POST);
    await expect(loadPostPage("en", "journal-wp-12", "journal")).resolves.toEqual(JOURNAL_POST);
  });

  it("answers a journal post under /blog and a blog post under /journal with the 404", async () => {
    await expectNotFound(loadPostPage("en", "journal-wp-12", "post"));
    await expectNotFound(loadPostPage("en", "why-an-outbox", "journal"));
  });

  it("looks for another locale's slug only in the list of the route's kind", async () => {
    // `diario-wp-12` is the journal post's Spanish slug: the journal redirects, the blog does not.
    await expect(loadPostPage("en", "diario-wp-12", "journal")).rejects.toMatchObject({
      digest: expect.stringContaining("/en/journal/journal-wp-12"),
    });
    await expectNotFound(loadPostPage("en", "diario-wp-12", "post"));
    const lists = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes("kind="));
    expect(lists).toEqual([
      `${BASE}/v1/content/en/posts?kind=journal`,
      `${BASE}/v1/content/en/posts?kind=post`,
    ]);
  });
});
