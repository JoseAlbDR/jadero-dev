import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { ContentScope } from "../src/modules/content/application/content.unit-of-work.js";
import { ApproveKnowledgeEntry } from "../src/modules/content/application/use-cases/approve-knowledge-entry.use-case.js";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import { CreateKnowledgeEntry } from "../src/modules/content/application/use-cases/create-knowledge-entry.use-case.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import {
  type ContentSeedItem,
  SeedContent,
} from "../src/modules/content/application/use-cases/seed-content.use-case.js";
import { LocaleIncomplete } from "../src/modules/content/domain/content.errors.js";
import { LOCALES } from "../src/modules/content/domain/locale.js";
import { contentSeed } from "../src/seed/content-seed-data.js";
import { type ContentPorts, contentPorts } from "./content-use-case.fakes.js";

// WP-12 step 6: `SeedContent` (Q2 A, owner decision A "create if missing, never touch what exists")
// on the in-memory unit of work, with the real seed data. The Postgres twin is
// `content-seed.int.test.ts`.

let ports: ContentPorts;
let seed: SeedContent;

beforeEach(() => {
  ports = contentPorts();
  seed = new SeedContent(
    ports.uow,
    new CreateContentItem(ports.uow, ports.ids),
    new SaveContentRevision(ports.uow, ports.ids, ports.clock),
    new PublishContentItem(ports.uow, ports.clock),
    new CreateKnowledgeEntry(ports.uow, ports.ids, ports.clock),
    new ApproveKnowledgeEntry(ports.uow, ports.clock),
  );
});

/** A seeded localized item through its own repository, as a reader would load it. */
function loadSeeded(
  scope: ContentScope,
  item: Exclude<ContentSeedItem, { type: "knowledge-entry" }>,
) {
  switch (item.type) {
    case "profile":
      return scope.profile.find();
    case "experience-item":
      return scope.experienceItems.get(item.id);
    case "project":
      return scope.projects.get(item.id);
    case "post":
      return scope.posts.get(item.id);
    case "skill":
      return scope.skills.get(item.id);
    case "cv-bullet":
      return scope.cvBullets.get(item.id);
  }
}

/** Every seeded item's version and per-locale state (entries: the approved revision). */
function state() {
  return ports.read(async (scope) =>
    Promise.all(
      contentSeed.map(async (item) => {
        if (item.type === "knowledge-entry") {
          const entry = await scope.knowledgeEntries.get(item.id);
          return { id: item.id, version: entry?.version, approved: entry?.approvedRevisionId };
        }
        const stored = await loadSeeded(scope, item);
        const states = LOCALES.map((l) => `${l}:${stored?.translations.stateOf(l)}`);
        return { id: item.id, version: stored?.version, states };
      }),
    ),
  );
}

describe("SeedContent", () => {
  it("creates and publishes every item on the first run", async () => {
    const report = await seed.execute(contentSeed);
    expect(report).toEqual({
      profile: { created: 1, skipped: 0 },
      "experience-item": { created: 2, skipped: 0 },
      project: { created: 2, skipped: 0 },
      post: { created: 1, skipped: 0 },
      skill: { created: 2, skipped: 0 },
      "cv-bullet": { created: 3, skipped: 0 },
      "knowledge-entry": { created: 1, skipped: 0 },
    });
    for (const item of await state()) {
      if ("states" in item) {
        expect(item.states).toContain("es:published");
        expect(item.states).toContain("en:published");
      } else {
        expect(item.approved).toEqual(expect.any(String));
      }
    }
  });

  it("changes nothing on a second run: every item skipped, every version as it was", async () => {
    await seed.execute(contentSeed);
    const before = await state();
    const report = await seed.execute(contentSeed);
    expect(Object.values(report).every((counts) => counts.created === 0)).toBe(true);
    expect(report["cv-bullet"]).toEqual({ created: 0, skipped: 3 });
    expect(await state()).toEqual(before);
  });

  it("skips the profile when one exists with another id, and never touches it", async () => {
    await new CreateContentItem(ports.uow, ports.ids).execute({ type: "profile" });
    const report = await seed.execute(contentSeed);
    expect(report.profile).toEqual({ created: 0, skipped: 1 });
    const profile = await ports.read((scope) => scope.profile.find());
    expect(profile?.version).toBe(1);
  });

  it("leaves a failing item absent, not half-seeded, and keeps the items before it", async () => {
    const [profile, experience] = contentSeed;
    const broken = {
      type: "skill",
      id: "01990000-0000-7000-8000-00000000b001",
      sortOrder: 9,
      documents: {
        es: { name: "Ejemplo", category: "Pruebas", projectSlugs: [] },
        en: { name: "", category: "Testing", projectSlugs: [] },
      },
    } satisfies ContentSeedItem;
    const items = [profile, experience, broken].filter((i) => i !== undefined);
    await expect(seed.execute(items)).rejects.toThrow(LocaleIncomplete);
    expect(await ports.read((scope) => scope.skills.get(broken.id))).toBeUndefined();
    expect(await ports.read((scope) => scope.profile.find())).toBeDefined();
  });

  it("writes nothing when the seed data breaks its schema", async () => {
    const [profile] = contentSeed;
    const noEnglish = { type: "post", id: "01990000-0000-7000-8000-00000000b002", slug: "x" };
    const items = [profile, noEnglish] as unknown as ContentSeedItem[];
    await expect(seed.execute(items)).rejects.toThrow(ZodError);
    expect(await ports.read((scope) => scope.profile.find())).toBeUndefined();
  });
});
