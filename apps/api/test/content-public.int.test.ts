import { fileURLToPath } from "node:url";
import {
  type KnowledgeEntryDto,
  type PostPageDto,
  type ProjectDto,
  type ProjectListDto,
  postCursor,
} from "@jadero/contracts";
import { drizzleOn, runMigrations } from "@jadero/platform-nest";
import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArchiveContentItem } from "../src/modules/content/application/use-cases/archive-content-item.use-case.js";
import { DeleteKnowledgeEntry } from "../src/modules/content/application/use-cases/delete-knowledge-entry.use-case.js";
import { WithdrawKnowledgeEntry } from "../src/modules/content/application/use-cases/withdraw-knowledge-entry.use-case.js";
import { type ContentSeedItem, SeedContent } from "../src/modules/content/index.js";
import { DrizzleContentQueries } from "../src/modules/content/infrastructure/drizzle-content-queries.js";
import { PUBLIC_CACHE_CONTROL } from "../src/modules/content/presentation/public-cache.interceptor.js";
import { contentSeed } from "../src/seed/content-seed-data.js";
import { SeedModule } from "../src/seed/seed.module.js";
import { bootApi } from "./setup/boot.js";
import { CONTENT_READER, createContentTestDatabase } from "./setup/content-database.js";
import { rawGet } from "./setup/raw-get.js";

// WP-12 step 7a on Postgres: the query service (CQRS read side) and the /v1 routes, reading as the
// read-only role `content_reader` while the seed writes as the owner. Placeholder content only
// (ADR-031): the db:seed data plus an archived project, 22 more posts (a second page) and two
// entries that were approved, then withdrawn or deleted.

const ARCHIVED_PROJECT = "01990000-0000-7000-8000-000000000299";
const EXTRA_POSTS = 22;

const entry = (id: string): ContentSeedItem => ({
  type: "knowledge-entry",
  id,
  document: {
    title: "A hidden sample entry",
    type: "feature",
    domain: "messaging",
    period: { from: "2024-02", to: null },
    role: "contributor",
    sections: [
      { key: "summary", body: "Placeholder summary." },
      { key: "problem", body: "Placeholder problem." },
      { key: "whatHeBuilt", body: "Placeholder build." },
    ],
    questions: ["What is hidden?"],
    stack: [],
    patterns: [],
    related: [],
    cvBullet: null,
    indexable: true,
  },
  provenance: { sources: ["private note"], conflicts: "", publicNames: [], confidence: "low" },
});

const extraItems: ContentSeedItem[] = [
  {
    type: "project",
    id: ARCHIVED_PROJECT,
    slug: "archived-project",
    kind: "project",
    featured: false,
    sortOrder: 9,
    documents: {
      es: projectDocument("proyecto-archivado"),
      en: projectDocument("archived-project"),
    },
  },
  ...Array.from({ length: EXTRA_POSTS }, (_, i): ContentSeedItem => {
    const n = String(i + 1).padStart(2, "0");
    return {
      type: "post",
      id: `01990000-0000-7000-8000-0000000005${n}`,
      slug: `sample-post-${n}`,
      documents: { es: postDocument(`entrada-${n}`), en: postDocument(`sample-post-${n}`) },
    };
  }),
  entry("kb-sample-withdrawn"),
  entry("kb-sample-deleted"),
];

function projectDocument(slug: string) {
  return {
    slug,
    title: "Placeholder",
    summary: "Placeholder.",
    body: "Placeholder.",
    stackTags: [],
    repoUrl: null,
    demoUrl: null,
  };
}

function postDocument(slug: string) {
  return { slug, title: "Placeholder", excerpt: "Placeholder.", body: "Placeholder.", tags: [] };
}

let owner: pg.Pool;
let readerUrl: string;
let drop: () => Promise<void>;
let app: INestApplication;
let base: string;

/** The version an item is at now, read as the owner. */
async function versionOf(table: string, id: string): Promise<number> {
  const { rows } = await owner.query<{ version: number }>(
    `SELECT version FROM content.${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.version ?? 0;
}

beforeAll(async () => {
  const database = await createContentTestDatabase();
  drop = database.drop;
  readerUrl = database.roleUrls[CONTENT_READER] ?? "";
  await runMigrations({
    service: "api",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  owner = new pg.Pool({ connectionString: database.url, max: 2 });

  const writer: INestApplicationContext = await NestFactory.createApplicationContext(
    SeedModule.forRoot({ url: database.url, poolMax: 2 }),
    { logger: false },
  );
  try {
    await writer.get(SeedContent).execute([...contentSeed, ...extraItems]);
    await writer.get(ArchiveContentItem).execute({
      type: "project",
      id: ARCHIVED_PROJECT,
      expectedVersion: await versionOf("projects", ARCHIVED_PROJECT),
    });
    await writer.get(WithdrawKnowledgeEntry).execute({
      id: "kb-sample-withdrawn",
      expectedVersion: await versionOf("knowledge_entries", "kb-sample-withdrawn"),
    });
    await writer.get(DeleteKnowledgeEntry).execute({
      id: "kb-sample-deleted",
      expectedVersion: await versionOf("knowledge_entries", "kb-sample-deleted"),
    });
  } finally {
    await writer.close();
  }

  ({ app, base } = await bootApi({ DATABASE_URL: database.url, DATABASE_READ_URL: readerUrl }));
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await drop?.();
});

/** GETs a path of the running app and parses the JSON body. */
async function getJson<T>(path: string): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`);
  return { res, body: (await res.json()) as T };
}

describe("DrizzleContentQueries on Postgres, as content_reader", () => {
  let reader: pg.Pool;
  let queries: DrizzleContentQueries;

  beforeAll(() => {
    reader = new pg.Pool({ connectionString: readerUrl, max: 2 });
    queries = new DrizzleContentQueries(drizzleOn(reader));
  });

  afterAll(async () => {
    await reader.end();
  });

  it("falls back to English per item in a German list, and never shows an archived item", async () => {
    const { items } = await queries.projects("de");
    expect(items.map((item) => [item.slug, item.locale])).toEqual([
      ["beispiel-fallstudie", "de"],
      ["sample-project", "en"],
    ]);
    expect(items[0]?.alternates).toEqual({
      es: "caso-de-ejemplo",
      en: "sample-case-study",
      de: "beispiel-fallstudie",
    });
    expect(items[1]?.alternates).not.toHaveProperty("de");
    expect(await queries.project("en", "archived-project")).toBeUndefined();
  });

  it("filters projects by kind", async () => {
    const { items } = await queries.projects("en", "case_study");
    expect(items.map((item) => item.slug)).toEqual(["sample-case-study"]);
  });

  it("pages posts newest first by first publication, 20 per page, without gaps or repeats", async () => {
    const first = await queries.posts("en");
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const after = postCursor.parse(first.nextCursor);
    const second = await queries.posts("en", after);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((post) => post.slug)).size).toBe(EXTRA_POSTS + 1);
    const dates = all.map((post) => post.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("shows a German experience item's bullets in German only, each with its approved entries", async () => {
    const { items } = await queries.experience("de");
    expect(items.map((item) => item.locale)).toEqual(["de", "en"]);
    expect(items[0]?.bullets).toEqual([
      {
        id: "sample-backend-1",
        text: "Baute einen Beispieldienst mit einer Nachrichtenwarteschlange.",
        entryIds: ["kb-sample-message-queue"],
      },
    ]);
    const english = await queries.experience("en");
    expect(english.items[0]?.bullets.map((bullet) => bullet.id)).toEqual([
      "sample-backend-1",
      "sample-backend-2",
    ]);
  });

  it("lists only approved entries: a withdrawn or deleted one is gone", async () => {
    const { items } = await queries.workLog();
    expect(items.map((item) => item.id)).toEqual(["kb-sample-message-queue"]);
    expect(await queries.workEntry("kb-sample-withdrawn")).toBeUndefined();
    expect(await queries.workEntry("kb-sample-deleted")).toBeUndefined();
  });
});

describe("GET /v1/content over HTTP, against Postgres", () => {
  it("answers each route with 200, the public cache headers and the body's language", async () => {
    const routes: [string, string][] = [
      ["/v1/content/es/profile", "es"],
      ["/v1/content/de/experience", "de, en"],
      ["/v1/content/de/projects", "de, en"],
      ["/v1/content/de/projects/beispiel-fallstudie", "de"],
      ["/v1/content/de/posts", "en"],
      ["/v1/content/en/posts/hello-world", "en"],
      ["/v1/content/de/skills", "de, en"],
      ["/v1/content/work", "en"],
      ["/v1/content/work/kb-sample-message-queue", "en"],
    ];
    for (const [path, language] of routes) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe(PUBLIC_CACHE_CONTROL);
      expect(res.headers.get("content-language"), path).toBe(language);
    }
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const url = `${base}/v1/content/en/projects/sample-case-study`;
    const first = await rawGet(url);
    expect(first.status).toBe(200);
    const again = await rawGet(url, { "if-none-match": String(first.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    expect(again.headers["cache-control"]).toBe(PUBLIC_CACHE_CONTROL);
  });

  it("serves a German detail from the English slug only when German is not published", async () => {
    const fallback = await getJson<ProjectDto>("/v1/content/de/projects/sample-project");
    expect(fallback.res.headers.get("content-language")).toBe("en");
    expect(fallback.body).toMatchObject({ locale: "en", slug: "sample-project" });
    // The case study has a German version, so its English slug is not a German page.
    const res = await fetch(`${base}/v1/content/de/projects/sample-case-study`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("hides an archived project from the list and its page", async () => {
    const { body } = await getJson<ProjectListDto>("/v1/content/en/projects");
    expect(body.items.map((item) => item.slug)).not.toContain("archived-project");
    expect((await fetch(`${base}/v1/content/en/projects/archived-project`)).status).toBe(404);
  });

  it("pages the posts with the opaque cursor", async () => {
    const first = await getJson<PostPageDto>("/v1/content/en/posts");
    const second = await getJson<PostPageDto>(
      `/v1/content/en/posts?cursor=${first.body.nextCursor}`,
    );
    expect(first.body.items).toHaveLength(20);
    expect(second.body.items).toHaveLength(EXTRA_POSTS + 1 - 20);
    expect(second.body.nextCursor).toBeNull();
  });

  it("never sends an entry's private provenance, nor a hidden entry", async () => {
    const res = await fetch(`${base}/v1/content/work/kb-sample-message-queue`);
    const text = await res.text();
    for (const name of ["sources", "conflicts", "publicNames", "public_names", "confidence"]) {
      expect(text).not.toContain(name);
    }
    expect((JSON.parse(text) as KnowledgeEntryDto).cvBullet).toBe("sample-backend-1");
    expect((await fetch(`${base}/v1/content/work/kb-sample-withdrawn`)).status).toBe(404);
    expect((await fetch(`${base}/v1/content/work/kb-sample-deleted`)).status).toBe(404);
  });

  it("is a 400 for an unknown locale, and keeps /health unversioned", async () => {
    expect((await fetch(`${base}/v1/content/fr/projects`)).status).toBe(400);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    expect((await fetch(`${base}/v1/health/ready`)).status).toBe(404);
  });
});

describe("the content_reader role", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: readerUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  /** Runs one statement and returns the Postgres error code it failed with. */
  async function failureCode(text: string): Promise<string | undefined> {
    try {
      await client.query(text);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  it("cannot read the private provenance or any table it was not granted (42501)", async () => {
    expect(await failureCode("SELECT * FROM content.knowledge_entry_provenance")).toBe("42501");
    expect(await failureCode("SELECT * FROM messaging.outbox")).toBe("42501");
    expect(await failureCode("SELECT * FROM content.profile")).toBe("42501");
  });

  it("cannot write: read-only by default (25006), and without the privilege when it turns that off (42501)", async () => {
    const insert = `INSERT INTO content.posts (id, slug, version)
      VALUES ('01990000-0000-7000-8000-000000000999', 'intruder', 1)`;
    expect(await failureCode(insert)).toBe("25006");
    await client.query("SET default_transaction_read_only = off");
    expect(await failureCode(insert)).toBe("42501");
  });
});
