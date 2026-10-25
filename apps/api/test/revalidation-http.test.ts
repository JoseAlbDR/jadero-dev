import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { REVALIDATE_SIGNATURE_HEADER, revalidateSignature } from "@jadero/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyStatus, HttpWebCache } from "../src/modules/revalidation/http-web-cache.js";
import { signRevalidation } from "../src/modules/revalidation/revalidation-signature.js";

const SECRET = "a-test-secret-of-at-least-32-characters";
const REQUEST = {
  changes: [{ kind: "project" as const, id: crypto.randomUUID(), slug: "jobportal" }],
};
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const NOW_MS = 1_793_700_721_500;

describe("signRevalidation", () => {
  it("is t=<seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'> and parses with the contract", () => {
    const header = signRevalidation(SECRET, '{"changes":[]}', 1793700721);
    const expected = createHmac("sha256", SECRET).update('1793700721.{"changes":[]}').digest("hex");
    expect(header).toBe(`t=1793700721,v1=${expected}`);
    expect(revalidateSignature.parse(header)).toEqual({ timestamp: 1793700721, digest: expected });
  });

  it("changes with the body, the time and the key", () => {
    const base = signRevalidation(SECRET, "a", 1);
    expect(signRevalidation(SECRET, "b", 1)).not.toBe(base);
    expect(signRevalidation(SECRET, "a", 2)).not.toBe(base);
    expect(signRevalidation(`${SECRET}x`, "a", 1)).not.toBe(base);
  });
});

describe("classifyStatus", () => {
  it.each([200, 204])("%i: revalidated", (status) => {
    expect(classifyStatus(status)).toEqual({ kind: "revalidated" });
  });

  it.each([500, 502, 503, 504, 404])("%i: transient, a later attempt can succeed", (status) => {
    expect(classifyStatus(status)).toEqual({ kind: "transient", reason: `web answered ${status}` });
  });

  it.each([400, 401, 403, 405, 413, 301, 307])("%i: permanent, waiting cannot fix it", (status) => {
    expect(classifyStatus(status)).toEqual({ kind: "permanent", reason: `web answered ${status}` });
  });
});

describe("HttpWebCache against a local HTTP server", () => {
  let server: Server;
  let url: string;
  let status = 204;
  let hang = false;
  const seen: { method?: string | undefined; headers: IncomingMessage["headers"]; body: string }[] =
    [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        seen.push({ method: req.method, headers: req.headers, body });
        if (hang) return;
        res.writeHead(status, status === 307 ? { location: "/en" } : {});
        res.end(status === 204 ? undefined : "a body the adapter never reads");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revalidate`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    seen.length = 0;
    status = 204;
    hang = false;
  });

  const cache = (timeoutMs = 2000) =>
    new HttpWebCache({ url, secret: SECRET, timeoutMs, now: () => NOW_MS });

  it("POSTs the JSON body signed at the current second, with the trace context", async () => {
    await expect(cache().revalidate(REQUEST, TRACEPARENT)).resolves.toEqual({
      kind: "revalidated",
    });
    const [call] = seen;
    expect(call?.method).toBe("POST");
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(call?.headers.traceparent).toBe(TRACEPARENT);
    expect(JSON.parse(call?.body ?? "")).toEqual(REQUEST);
    expect(call?.headers[REVALIDATE_SIGNATURE_HEADER]).toBe(
      signRevalidation(SECRET, call?.body ?? "", Math.floor(NOW_MS / 1000)),
    );
  });

  it("sends no traceparent when nothing is traced", async () => {
    await cache().revalidate(REQUEST);
    expect(seen[0]?.headers.traceparent).toBeUndefined();
  });

  it("classifies web's status without reading its body", async () => {
    status = 503;
    await expect(cache().revalidate(REQUEST)).resolves.toEqual({
      kind: "transient",
      reason: "web answered 503",
    });
    status = 401;
    await expect(cache().revalidate(REQUEST)).resolves.toEqual({
      kind: "permanent",
      reason: "web answered 401",
    });
  });

  it("does not follow a redirect: a URL that points at a page is permanent", async () => {
    status = 307;
    await expect(cache().revalidate(REQUEST)).resolves.toEqual({
      kind: "permanent",
      reason: "web answered 307",
    });
    expect(seen).toHaveLength(1);
  });

  it("gives up after the timeout, as a transient failure", async () => {
    hang = true;
    await expect(cache(100).revalidate(REQUEST)).resolves.toEqual({
      kind: "transient",
      reason: "web timed out",
    });
  });

  it("treats a refused connection as transient and names only the error code", async () => {
    // A port that was just free: fetch refuses well-known ports such as 1 before connecting.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));
    const closed = new HttpWebCache({
      url: `http://127.0.0.1:${port}/api/revalidate`,
      secret: SECRET,
    });
    await expect(closed.revalidate(REQUEST)).resolves.toEqual({
      kind: "transient",
      reason: "web unreachable: Error (ECONNREFUSED)",
    });
  });
});
