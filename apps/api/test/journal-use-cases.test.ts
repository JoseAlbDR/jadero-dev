import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import {
  ImportJournalPost,
  journalSlug,
  samePostDocument,
} from "../src/modules/content/application/use-cases/import-journal-post.use-case.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { PublishJournalPost } from "../src/modules/content/application/use-cases/publish-journal-post.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import {
  InvalidTransition,
  ItemNotFound,
  RequiredLocalesMissing,
} from "../src/modules/content/domain/content.errors.js";
import type { Locale } from "../src/modules/content/domain/locale.js";
import type { PostDocument } from "../src/modules/content/domain/post.js";
import { type ContentPorts, contentPorts } from "./content-use-case.fakes.js";

// WP-39 step 4 (D3, ADR-034): the journal import upserts by work package and never publishes; the
// publish command goes through the domain's guards (D-20). On the in-memory unit of work; the
// Postgres twin is `journal.int.test.ts`.

let ports: ContentPorts;
let importPost: ImportJournalPost;
let publishPost: PublishJournalPost;

beforeEach(() => {
  ports = contentPorts();
  const saveRevision = new SaveContentRevision(ports.uow, ports.ids, ports.clock);
  importPost = new ImportJournalPost(
    ports.uow,
    new CreateContentItem(ports.uow, ports.ids),
    saveRevision,
  );
  publishPost = new PublishJournalPost(ports.uow, new PublishContentItem(ports.uow, ports.clock));
});

/** A complete journal document in one locale; `marker` changes the body. */
function doc(locale: Locale, marker = "v1"): PostDocument {
  return {
    slug: `journal-${locale}`,
    title: `Journal (${locale})`,
    excerpt: "A summary.",
    body: `What I built, ${marker}.`,
    tags: [],
  };
}

const journal = (wp: number) => ports.read((scope) => scope.posts.findJournal(wp));

describe("ImportJournalPost", () => {
  it("creates the journal post with a draft revision, never published", async () => {
    expect(await importPost.execute({ wp: 41, locale: "en", document: doc("en") })).toBe("created");
    const post = await journal(41);
    expect(post).toMatchObject({ kind: "journal", wp: 41, slug: journalSlug(41), version: 2 });
    expect(post?.translations.stateOf("en")).toBe("draft");
    expect(post?.translations.latest("en")?.document).toEqual(doc("en"));
  });

  it("reports unchanged on a second import of the same document and saves nothing", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    expect(await importPost.execute({ wp: 41, locale: "en", document: doc("en") })).toBe(
      "unchanged",
    );
    expect((await journal(41))?.version).toBe(2);
  });

  it("creates a new locale on the same post, then revises a changed document", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    expect(await importPost.execute({ wp: 41, locale: "es", document: doc("es") })).toBe("created");
    expect(await importPost.execute({ wp: 41, locale: "en", document: doc("en", "v2") })).toBe(
      "revised",
    );
    const post = await journal(41);
    expect(post?.version).toBe(4);
    expect(post?.translations.latest("en")?.number).toBe(2);
    expect(post?.translations.latest("es")?.number).toBe(1);
  });

  it("revises a published locale into changed: the live revision stays until a publish", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    await importPost.execute({ wp: 41, locale: "es", document: doc("es") });
    await publishPost.execute({ wp: 41 });
    expect(await importPost.execute({ wp: 41, locale: "en", document: doc("en", "v2") })).toBe(
      "revised",
    );
    expect((await journal(41))?.translations.stateOf("en")).toBe("changed");
  });

  it("refuses a malformed command before anything runs", async () => {
    await expect(importPost.execute({ wp: 0, locale: "en", document: doc("en") })).rejects.toThrow(
      ZodError,
    );
    expect(await journal(0)).toBeUndefined();
  });
});

describe("samePostDocument", () => {
  it("compares every field and the tags in order", () => {
    expect(samePostDocument(doc("en"), doc("en"))).toBe(true);
    expect(samePostDocument(doc("en"), { ...doc("en"), excerpt: "Other." })).toBe(false);
    expect(
      samePostDocument({ ...doc("en"), tags: ["a", "b"] }, { ...doc("en"), tags: ["b", "a"] }),
    ).toBe(false);
    expect(samePostDocument({ ...doc("en"), tags: ["a"] }, doc("en"))).toBe(false);
  });
});

describe("PublishJournalPost", () => {
  it("refuses to publish without es (D-20), and stores nothing", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    await expect(publishPost.execute({ wp: 41 })).rejects.toThrow(RequiredLocalesMissing);
    expect((await journal(41))?.translations.stateOf("en")).toBe("draft");
  });

  it("publishes every locale with a pending draft by default, warning on de", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    await importPost.execute({ wp: 41, locale: "es", document: doc("es") });
    const result = await publishPost.execute({ wp: 41 });
    expect(result.published.map((p) => p.locale)).toEqual(["es", "en"]);
    expect(result.warnings).toEqual([{ code: "optional-locale-unpublished", locale: "de" }]);
    expect((await publishPost.execute({ wp: 41 })).published).toEqual([]);
  });

  it("publishes only the named locales", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    await importPost.execute({ wp: 41, locale: "es", document: doc("es") });
    await importPost.execute({ wp: 41, locale: "de", document: doc("de") });
    const result = await publishPost.execute({ wp: 41, locales: ["en", "es"] });
    expect(result.published.map((p) => p.locale)).toEqual(["en", "es"]);
    expect((await journal(41))?.translations.stateOf("de")).toBe("draft");
  });

  it("fails on a work package with no journal post", async () => {
    await expect(publishPost.execute({ wp: 99 })).rejects.toThrow(ItemNotFound);
  });

  it("refuses a malformed command before anything runs", async () => {
    await expect(publishPost.execute({ wp: 41, locales: [] })).rejects.toThrow(ZodError);
  });

  it("an archived journal post cannot be revised", async () => {
    await importPost.execute({ wp: 41, locale: "en", document: doc("en") });
    await ports.uow.run(async (scope) => {
      const post = await scope.posts.findJournal(41);
      if (!post) throw new Error("missing");
      post.archive(ports.clock.now());
      await scope.posts.save(post, post.version);
    });
    await expect(
      importPost.execute({ wp: 41, locale: "en", document: doc("en", "v2") }),
    ).rejects.toThrow(InvalidTransition);
  });
});
