import { createHmac } from "node:crypto";
import { REVALIDATE_SIGNATURE_HEADER } from "@jadero/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tagsForChanges } from "../src/content/revalidate-tags";
import { verifyRevalidationSignature } from "../src/security/revalidate-signature";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));

const { POST } = await import("../src/app/api/revalidate/route");

const SECRET = "a-test-secret-of-at-least-32-characters";
const ID = "0199f3a2-1b7c-7e10-8d4f-2a6b9c0d1e3f";
const NOW = 1_793_700_721;

/** The header `api-worker` sends: `t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
function sign(body: string, timestamp = NOW, secret = SECRET): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** A revalidation call as it reaches the route. */
function call(body: string, signature: string | null = sign(body)): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set(REVALIDATE_SIGNATURE_HEADER, signature);
  return new Request("http://web:3000/api/revalidate", { method: "POST", headers, body });
}

const body = JSON.stringify({ changes: [{ kind: "project", id: ID, slug: "jobportal" }] });

describe("tagsForChanges (web owns its cache keys, WP-14 Q1 B)", () => {
  it.each([
    [{ kind: "profile", id: ID }, ["content:profile"]],
    [{ kind: "now", id: ID }, ["content:now"]],
    [{ kind: "experience-item", id: ID }, ["content:experience"]],
    [{ kind: "cv-bullet", id: "outbox-relay" }, ["content:experience"]],
    [
      { kind: "project", id: ID, slug: "jobportal" },
      ["content:projects", "content:projects:jobportal"],
    ],
    [{ kind: "post", id: ID, slug: "der-outbox" }, ["content:posts", "content:posts:der-outbox"]],
    [{ kind: "skill", id: ID }, ["content:skills"]],
    [
      { kind: "knowledge-entry", id: "kb-outbox-relay" },
      ["content:work", "content:work:kb-outbox-relay", "content:experience"],
    ],
  ] as const)("%o drops %o", (change, tags) => {
    expect(tagsForChanges([change])).toEqual(tags);
  });

  it("drops a tag two changes share once", () => {
    expect(
      tagsForChanges([
        { kind: "project", id: ID, slug: "app-de-tareas" },
        { kind: "project", id: ID, slug: "todo-app" },
      ]),
    ).toEqual(["content:projects", "content:projects:app-de-tareas", "content:projects:todo-app"]);
  });
});

describe("verifyRevalidationSignature", () => {
  it("accepts the signature of this body and key within five minutes either way", () => {
    expect(verifyRevalidationSignature(sign(body), body, SECRET, NOW)).toBe(true);
    expect(verifyRevalidationSignature(sign(body), body, SECRET, NOW + 300)).toBe(true);
    expect(verifyRevalidationSignature(sign(body), body, SECRET, NOW - 300)).toBe(true);
  });

  it.each([
    ["no header", null, NOW],
    ["a malformed header", "v1=abc", NOW],
    ["another body", sign(`${body} `), NOW],
    ["another key", sign(body, NOW, `${SECRET}x`), NOW],
    ["a timestamp too old", sign(body), NOW + 301],
    ["a timestamp too far ahead", sign(body), NOW - 301],
    ["a re-stamped header", sign(body).replace(`t=${NOW}`, `t=${NOW + 1}`), NOW],
  ])("refuses %s", (_name, header, now) => {
    expect(verifyRevalidationSignature(header, body, SECRET, now)).toBe(false);
  });
});

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW * 1000, toFake: ["Date"] });
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    revalidateTag.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("drops each tag with expire 0 and answers 204 with no body", async () => {
    const response = await POST(call(body));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(revalidateTag.mock.calls).toEqual([
      ["content:projects", { expire: 0 }],
      ["content:projects:jobportal", { expire: 0 }],
    ]);
  });

  it("logs the count of tags only, never the body", async () => {
    await POST(call(body));
    expect(console.info).toHaveBeenCalledWith("revalidate: 2 tags dropped");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("jobportal");
  });

  it.each([
    ["no signature", call(body, null)],
    ["a wrong signature", call(body, sign(body, NOW, `${SECRET}x`))],
    ["an expired signature", call(body, sign(body, NOW - 301))],
  ])("answers 401 to %s and drops nothing", async (_name, request) => {
    expect((await POST(request)).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", ""],
    ["too short", "secret"],
  ])("answers 401 to every call when the key is %s", async (_name, value) => {
    vi.stubEnv("REVALIDATE_SECRET", value);
    const signed = call(body, sign(body, NOW, value || SECRET));
    expect((await POST(signed)).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "changes"],
    ["no changes", JSON.stringify({ changes: [] })],
    ["an unknown kind", JSON.stringify({ changes: [{ kind: "page", id: ID }] })],
    ["tags instead of changes", JSON.stringify({ tags: ["content:projects"] })],
  ])("answers 400 to a signed body with %s and drops nothing", async (_name, text) => {
    expect((await POST(call(text))).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("answers 413 to a body larger than any call, before checking it", async () => {
    const large = "x".repeat(16 * 1024 + 1);
    expect((await POST(call(large))).status).toBe(413);
  });
});

describe("the proxy leaves the route alone", () => {
  it("does not match /api/revalidate, so no CSP, nonce or locale redirect reaches it", async () => {
    const { config } = await import("../src/proxy");
    const matcher = new RegExp(`^${config.matcher}$`);
    expect(matcher.test("/api/revalidate")).toBe(false);
    expect(matcher.test("/en/projects")).toBe(true);
  });
});
