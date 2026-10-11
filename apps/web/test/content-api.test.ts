import profile from "@jadero/contracts/fixtures/content/profile.json" with { type: "json" };
import project from "@jadero/contracts/fixtures/content/project.json" with { type: "json" };
import workEntry from "@jadero/contracts/fixtures/content/work-entry.json" with { type: "json" };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_REVALIDATE_SECONDS,
  ContentApiError,
  findPost,
  getPost,
  getPosts,
  getProfile,
  getProject,
  getProjects,
  getWorkEntry,
} from "../src/content/api";

const BASE = "http://api.internal:3001";

type FetchArgs = [string, RequestInit & { next?: { revalidate?: number; tags?: string[] } }];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

function json(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

/** The 404 problem body `api` returns for a missing item (RFC 9457). */
const NOT_FOUND_PROBLEM = {
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "No published project 'missing' in en.",
  instance: "/v1/content/en/projects/missing",
};

/** Asserts that `promise` rejects with the error `notFound()` throws (Next's 404 fallback). */
async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404/),
  });
}

/** The error a promise rejects with, to check what its message carries. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.stubEnv("CONTENT_API_URL", `${BASE}/`);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("content API client", () => {
  it("parses a response with its contract and caches it under the content tags", async () => {
    fetchMock.mockResolvedValue(json(profile));

    await expect(getProfile("en")).resolves.toEqual(profile);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/v1/content/en/profile`);
    expect(init?.next).toEqual({
      revalidate: CONTENT_REVALIDATE_SECONDS,
      tags: ["content:profile"],
    });
  });

  it("tags an item with its type and its slug, and drops keys the contract does not know", async () => {
    fetchMock.mockResolvedValue(json({ ...project, internalNote: "not public" }));

    const result = await getProject("de", "jobportal");

    expect(result).toEqual(project);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/v1/content/de/projects/jobportal`);
    expect(init?.next?.tags).toEqual(["content:projects", "content:projects:jobportal"]);
  });

  it("passes the list filters as query parameters", async () => {
    fetchMock.mockImplementation(async () => json({ items: [], nextCursor: null }));

    await getProjects("es", "case_study");
    await getPosts("en", "abc_-1");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/v1/content/es/projects?kind=case_study`,
      `${BASE}/v1/content/en/posts?cursor=abc_-1`,
    ]);
  });

  it("maps a 404 problem to the page's 404", async () => {
    fetchMock.mockResolvedValue(json(NOT_FOUND_PROBLEM, 404, "application/problem+json"));

    await expectNotFound(getProject("en", "missing"));
  });

  it("lets a post lookup answer null for the 404 problem, so the page can look further", async () => {
    // A fresh response per call: a body can be read once.
    fetchMock.mockImplementation(async () =>
      json(NOT_FOUND_PROBLEM, 404, "application/problem+json"),
    );

    await expect(findPost("en", "missing")).resolves.toBeNull();
    await expectNotFound(getPost("en", "missing"));
  });

  it("treats a 404 without a problem body as an error, not a missing page", async () => {
    fetchMock.mockResolvedValue(new Response("<html>nginx</html>", { status: 404 }));

    const error = await rejection(getProfile("en"));

    expect(error).toBeInstanceOf(ContentApiError);
    expect(error).toMatchObject({ resource: "profile", status: 404 });
  });

  it("answers a malformed slug with a 404 without calling the API", async () => {
    await expectNotFound(getProject("en", "Not A Slug"));
    await expectNotFound(getWorkEntry("outbox-relay"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a payload the contract refuses, without repeating it", async () => {
    fetchMock.mockResolvedValue(
      json({ ...workEntry, sections: [], title: "secret-looking value" }),
    );

    const error = await rejection(getWorkEntry("kb-outbox-relay"));

    expect(error).toBeInstanceOf(ContentApiError);
    expect(error.message).toBe("Content API returned an invalid work entry payload");
    expect(fetchMock.mock.calls[0]?.[1].next?.tags).toEqual([
      "content:work",
      "content:work:kb-outbox-relay",
    ]);
  });

  it("names the resource only when the API fails or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "stack trace" }, 500));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: "ECONNREFUSED" }));

    const failed = await rejection(getProfile("en"));
    const unreachable = await rejection(getProfile("en"));

    expect(failed).toMatchObject({ status: 500, message: "Content API answered 500 for profile" });
    expect(unreachable).toMatchObject({
      status: null,
      message: "Content API unreachable for profile",
    });
    for (const error of [failed, unreachable]) {
      expect(error.message).not.toContain("api.internal");
      expect(error.cause).toBeUndefined();
    }
  });

  it("refuses to run without a valid CONTENT_API_URL", async () => {
    vi.stubEnv("CONTENT_API_URL", "");

    await expect(getProfile("en")).rejects.toThrow(/CONTENT_API_URL must be an absolute/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("content fetch log (CONTENT_API_DEBUG)", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  afterEach(() => {
    info.mockClear();
  });

  /** The lines the client logged, one string per call. */
  const logged = () => info.mock.calls.map(([line]) => String(line));

  it("logs the URL, status, duration, cache hint and parsed body under next dev with the flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONTENT_API_DEBUG", "1");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(profile), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      }),
    );

    await getProfile("en");

    expect(logged()).toHaveLength(1);
    const [statusLine, ...rest] = (logged()[0] ?? "").split("\n");
    expect(statusLine).toMatch(
      new RegExp(
        `^\\[content-api\\] GET ${BASE}/v1/content/en/profile 200 in \\d+ms cache-control="public, max-age=60"$`,
      ),
    );
    expect(rest.join("\n")).toBe(`body: ${JSON.stringify(profile, null, 2)}`);
  });

  it("logs the problem body of an error status and the contract's issues of a refused payload", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONTENT_API_DEBUG", "1");
    fetchMock.mockResolvedValueOnce(json({ title: "Internal Server Error", status: 500 }, 500));
    fetchMock.mockResolvedValueOnce(json({ ...workEntry, sections: [] }));

    const failed = await rejection(getProfile("en"));
    const invalid = await rejection(getWorkEntry("kb-outbox-relay"));

    const [problem, issues] = logged();
    expect(problem).toContain(" 500 in ");
    expect(problem).toContain('problem: {\n  "title": "Internal Server Error"');
    expect(issues).toContain("invalid payload: [");
    expect(issues).toContain('"sections"');
    // The errors thrown to the page still carry neither the URL nor a body.
    for (const error of [failed, invalid]) {
      expect(error.message).not.toContain("api.internal");
      expect(error.message).not.toContain("Internal Server Error");
    }
  });

  it("stays silent under next dev without the flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    fetchMock.mockResolvedValue(json(profile));

    await getProfile("en");

    expect(info).not.toHaveBeenCalled();
  });

  it("stays silent in production even with the flag set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONTENT_API_DEBUG", "1");
    fetchMock.mockResolvedValueOnce(json(profile));
    fetchMock.mockResolvedValueOnce(json({ detail: "stack trace" }, 500));

    await getProfile("en");
    await rejection(getProfile("en"));

    expect(info).not.toHaveBeenCalled();
  });
});
