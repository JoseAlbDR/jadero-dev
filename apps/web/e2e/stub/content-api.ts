/*
 * A stub of the public content API for the e2e suite, started by playwright.config.ts next to the
 * standalone server, so `pnpm test:e2e` never needs Docker, Postgres or `api`. It answers
 * `GET /v1/content/:locale/experience` from `experience.json`, `GET /v1/content/:locale/projects`
 * (with `?kind=`) and `GET /v1/content/:locale/projects/:slug` from `projects.json`, and a 404
 * problem for anything else. `projects.json` holds each locale's answer as the API gives it,
 * the German fallback to English included. Every fixture is parsed with its `@jadero/contracts`
 * schema at start: a fixture that drifts from the contract stops the suite before a test runs.
 * Node runs this file directly (type stripping), so it holds only erasable TypeScript. It logs
 * nothing per request.
 */
import { createServer } from "node:http";
import {
  experienceListDto,
  locale,
  projectDto,
  projectKind,
  projectListDto,
} from "@jadero/contracts";
import { z } from "zod";
import experience from "./experience.json" with { type: "json" };
import projects from "./projects.json" with { type: "json" };

const experienceFixtures = z.record(locale, experienceListDto).parse(experience);
const projectFixtures = z.record(locale, z.array(projectDto)).parse(projects);
const port = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.E2E_API_PORT ?? "3211");

const EXPERIENCE_PATH = /^\/v1\/content\/(es|en|de)\/experience$/;
const PROJECTS_PATH = /^\/v1\/content\/(es|en|de)\/projects$/;
const PROJECT_PATH = /^\/v1\/content\/(es|en|de)\/projects\/([a-z0-9-]+)$/;

/**
 * The body the real API would send for a GET, or `undefined` for its 404.
 * @param url the request URL.
 */
function answer(url: URL): unknown {
  const path = url.pathname;
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
