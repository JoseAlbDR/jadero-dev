/*
 * A stub of the public content API for the e2e suite, started by playwright.config.ts next to the
 * standalone server, so `pnpm test:e2e` never needs Docker, Postgres or `api`. It answers
 * `GET /v1/content/:locale/experience` from `experience.json` and a 404 problem for anything else.
 * Every fixture is parsed with its `@jadero/contracts` schema at start: a fixture that drifts from
 * the contract stops the suite before a test runs. Node runs this file directly (type stripping),
 * so it holds only erasable TypeScript. It logs nothing per request.
 */
import { createServer } from "node:http";
import { experienceListDto, locale } from "@jadero/contracts";
import { z } from "zod";
import experience from "./experience.json" with { type: "json" };

const fixtures = z.record(locale, experienceListDto).parse(experience);
const port = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.E2E_API_PORT ?? "3211");

const EXPERIENCE_PATH = /^\/v1\/content\/(es|en|de)\/experience$/;

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://stub").pathname;
  if (request.method === "GET" && path === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  const match = request.method === "GET" ? EXPERIENCE_PATH.exec(path) : null;
  const body = match ? fixtures[locale.parse(match[1])] : undefined;
  if (body) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  response
    .writeHead(404, { "content-type": "application/problem+json" })
    .end(JSON.stringify({ type: "about:blank", title: "Not Found", status: 404 }));
});

server.listen(port, "127.0.0.1");
