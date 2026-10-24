import { fileURLToPath } from "node:url";
import {
  type KnowledgeEntryDto,
  type NowDto,
  type PostPageDto,
  type ProjectDto,
  type ProjectListDto,
  postCursor,
} from "@jadero/contracts";
import { drizzleOn, runMigrations } from "@jadero/platform-nest";
import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import pg from "pg";
import request from "supertest";
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

// WP-12 step 7a on Postgres: the query service (CQRS read side) and the /v1 routes, reading as the
// read-only role `content_reader` while the seed writes as the owner. Placeholder content only
// (ADR-031): the db:seed data plus an archived project, 22 more posts (a second page), one journal
// post (WP-39 D1) and two entries that were approved, then withdrawn or deleted. The seed itself
// carries the /now page in three locales and the journal post of WP-12 (WP-39 D2).

const ARCHIVED_PROJECT = "01990000-0000-7000-8000-000000000299";
const EXTRA_POSTS = 22;
const JOURNAL_POST = "01990000-0000-7000-8000-000000000639";

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
  {
    type: "post",
    id: JOURNAL_POST,
    slug: "journal-wp-39",
    kind: "journal",
    wp: 39,
    documents: { es: postDocument("diario-wp-39"), en: postDocument("journal-wp-39") },
  },
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

  app = await bootApi({ DATABASE_URL: database.url, DATABASE_READ_URL: readerUrl });
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await drop?.();
});

/** Starts a request against the app; supertest binds a free port for it. */
const http = () => request(app.getHttpServer());

/** GETs a path of the app and types the parsed JSON body. */
async function getJson<T>(path: string): Promise<{ res: request.Response; body: T }> {
  const res = await http().get(path);
  return { res, body: res.body as T };
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
    const first = await queries.posts("en", "post");
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const after = postCursor.parse(first.nextCursor);
    const second = await queries.posts("en", "post", after);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((post) => post.slug)).size).toBe(EXTRA_POSTS + 1);
    const dates = all.map((post) => post.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("lists the journal post only under its kind, and reads it by slug with its WP", async () => {
    const first = await queries.posts("en", "post");
    const second = await queries.posts("en", "post", postCursor.parse(first.nextCursor));
    const blog = [...first.items, ...second.items];
    expect(blog.map((post) => post.slug)).not.toContain("journal-wp-39");
    expect(blog.every((post) => post.kind === "post" && post.wp === null)).toBe(true);
    const journal = await queries.posts("en", "journal");
    expect(journal.items.map((post) => [post.slug, post.kind, post.wp])).toEqual([
      ["journal-wp-39", "journal", 39],
      ["journal-wp-12", "journal", 12],
    ]);
    expect(journal.nextCursor).toBeNull();
    expect(await queries.post("es", "diario-wp-39")).toMatchObject({ kind: "journal", wp: 39 });
  });

  it("reads the /now page per locale with the time its published text last moved", async () => {
    const german = await queries.now("de");
    expect(german).toMatchObject({ locale: "de", body: expect.stringContaining("Gerade") });
    const { rows } = await owner.query<{ published_at: Date }>(
      "SELECT published_at FROM content.now_translations WHERE locale = 'de'",
    );
    expect(german?.publishedAt).toBe(rows[0]?.published_at.toISOString());
    expect((await queries.now("es"))?.locale).toBe("es");
  });

  it("stores first_published_at at millisecond precision, the precision of the feed cursor", async () => {
    // The keyset cursor carries milliseconds; a microsecond value (an SQL now()) would make
    // `(first_published_at, post_id) < cursor` keep the row on the next page too.
    const { rows } = await owner.query<{ stored: number; finer: number }>(
      `SELECT count(first_published_at)::int AS stored,
         count(*) FILTER (WHERE date_trunc('milliseconds', first_published_at)
           <> first_published_at)::int AS finer
       FROM content.post_translations`,
    );
    expect(rows[0]?.stored).toBeGreaterThan(EXTRA_POSTS);
    expect(rows[0]?.finer).toBe(0);
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
      ["/v1/content/de/now", "de"],
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
      const res = await http().get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["cache-control"], path).toBe(PUBLIC_CACHE_CONTROL);
      expect(res.headers["content-language"], path).toBe(language);
    }
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const path = "/v1/content/en/projects/sample-case-study";
    const first = await http().get(path);
    expect(first.status).toBe(200);
    const again = await http().get(path).set("If-None-Match", String(first.headers.etag));
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.headers["cache-control"]).toBe(PUBLIC_CACHE_CONTROL);
  });

  it("serves a German detail from the English slug only when German is not published", async () => {
    const fallback = await getJson<ProjectDto>("/v1/content/de/projects/sample-project");
    expect(fallback.res.headers["content-language"]).toBe("en");
    expect(fallback.body).toMatchObject({ locale: "en", slug: "sample-project" });
    // The case study has a German version, so its English slug is not a German page.
    const res = await http().get("/v1/content/de/projects/sample-case-study");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("hides an archived project from the list and its page", async () => {
    const { body } = await getJson<ProjectListDto>("/v1/content/en/projects");
    expect(body.items.map((item) => item.slug)).not.toContain("archived-project");
    expect((await http().get("/v1/content/en/projects/archived-project")).status).toBe(404);
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

  it("lists the journal posts on ?kind=journal", async () => {
    const { res, body } = await getJson<PostPageDto>("/v1/content/en/posts?kind=journal");
    expect(res.status).toBe(200);
    expect(body.items).toMatchObject([
      { slug: "journal-wp-39", kind: "journal", wp: 39 },
      { slug: "journal-wp-12", kind: "journal", wp: 12 },
    ]);
  });

  it("answers the /now page with its update time, and 304 on a matching If-None-Match", async () => {
    const { res, body } = await getJson<NowDto>("/v1/content/en/now");
    expect(res.status).toBe(200);
    expect(body).toEqual({
      locale: "en",
      body: expect.stringContaining("Right now"),
      publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    const again = await http()
      .get("/v1/content/en/now")
      .set("If-None-Match", String(res.headers.etag));
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
  });

  it("never sends an entry's private provenance, nor a hidden entry", async () => {
    const res = await http().get("/v1/content/work/kb-sample-message-queue");
    const text = res.text;
    for (const name of ["sources", "conflicts", "publicNames", "public_names", "confidence"]) {
      expect(text).not.toContain(name);
    }
    expect((JSON.parse(text) as KnowledgeEntryDto).cvBullet).toBe("sample-backend-1");
    expect((await http().get("/v1/content/work/kb-sample-withdrawn")).status).toBe(404);
    expect((await http().get("/v1/content/work/kb-sample-deleted")).status).toBe(404);
  });

  it("is a 400 for an unknown locale, and keeps /health unversioned", async () => {
    expect((await http().get("/v1/content/fr/projects")).status).toBe(400);
    expect((await http().get("/health/ready")).status).toBe(200);
    expect((await http().get("/v1/health/ready")).status).toBe(404);
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
    expect(await failureCode("SELECT * FROM content.now")).toBe("42501");
  });

  it("cannot write: read-only by default (25006), and without the privilege when it turns that off (42501)", async () => {
    const insert = `INSERT INTO content.posts (id, slug, version)
      VALUES ('01990000-0000-7000-8000-000000000999', 'intruder', 1)`;
    expect(await failureCode(insert)).toBe("25006");
    await client.query("SET default_transaction_read_only = off");
    expect(await failureCode(insert)).toBe("42501");
  });
});

// Last, because it removes the seeded /now page from the shared database.
describe("GET /v1/content/:locale/now with nothing published, against Postgres", () => {
  it("is a 404 problem marked no-store in every locale, German falling back to nothing", async () => {
    await owner.query(
      "DELETE FROM content.now_translations; DELETE FROM content.now_revisions; DELETE FROM content.now;",
    );
    for (const locale of ["es", "en", "de"]) {
      const res = await http().get(`/v1/content/${locale}/now`);
      expect(res.status, locale).toBe(404);
      expect(res.headers["content-type"], locale).toContain("application/problem+json");
      expect(res.headers["cache-control"], locale).toBe("no-store");
    }
  });
});
