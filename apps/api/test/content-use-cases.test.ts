import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ArchiveContentItem } from "../src/modules/content/application/use-cases/archive-content-item.use-case.js";
import type {
  CreateContentItemCommand,
  SaveContentRevisionCommand,
} from "../src/modules/content/application/use-cases/content-commands.js";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import {
  LOCALIZED,
  type LocalizedType,
} from "../src/modules/content/application/use-cases/localized-types.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import {
  ConcurrentModification,
  FieldFormatInvalid,
  IdInvalid,
  InvalidTransition,
  ItemNotFound,
  LocaleIncomplete,
  RequiredLocalesMissing,
  SlugInvalid,
} from "../src/modules/content/domain/content.errors.js";
import type { Locale } from "../src/modules/content/domain/locale.js";
import type { ProjectDocument } from "../src/modules/content/domain/project.js";
import { type ContentPorts, contentPorts } from "./content-use-case.fakes.js";

// WP-12 step 6: the generic use cases (owner decision, granularity B) on the in-memory unit of
// work. One test per path a use case can take: the happy path per type, a stale expectedVersion
// (D5, Trace 2b), a domain refusal and a missing item, each proving what was left stored.

const EXPERIENCE = "01990000-0000-7000-8000-00000000a001";
const PROJECT = "01990000-0000-7000-8000-00000000a002";
const POST = "01990000-0000-7000-8000-00000000a003";
const SKILL = "01990000-0000-7000-8000-00000000a004";
const PROFILE = "01990000-0000-7000-8000-00000000a005";
const MISSING = "01990000-0000-7000-8000-00000000afff";

/** A complete project document, its title naming the locale and a marker. */
function projectDoc(locale: Locale, marker = "v1"): ProjectDocument {
  return {
    slug: `${locale}-sample`,
    title: `Sample ${marker} (${locale})`,
    summary: "A placeholder.",
    body: "Placeholder text.",
    stackTags: ["TypeScript"],
    repoUrl: null,
    demoUrl: null,
  };
}

/** One create command and one complete document per localized type, ids fixed. */
const TYPES: {
  readonly [K in LocalizedType]: {
    readonly create: CreateContentItemCommand & { readonly type: K };
    readonly id: string;
    readonly document: (
      locale: Locale,
    ) => Extract<SaveContentRevisionCommand, { type: K }>["document"];
  };
} = {
  profile: {
    create: { type: "profile", id: PROFILE },
    id: PROFILE,
    document: (locale) => ({
      name: `Alex (${locale})`,
      headline: "Engineer",
      summary: "Placeholder.",
      links: [{ kind: "website", url: "https://example.com" }],
    }),
  },
  "experience-item": {
    create: { type: "experience-item", id: EXPERIENCE, sortOrder: 1 },
    id: EXPERIENCE,
    document: () => ({
      organization: "Example Company",
      role: "Engineer",
      period: { from: "2024-01", to: null },
      locationType: "remote",
      stackTags: [],
    }),
  },
  project: {
    create: {
      type: "project",
      id: PROJECT,
      slug: "sample",
      kind: "project",
      featured: false,
      sortOrder: 1,
    },
    id: PROJECT,
    document: (locale) => projectDoc(locale),
  },
  post: {
    create: { type: "post", id: POST, slug: "sample-post" },
    id: POST,
    document: (locale) => ({
      slug: `${locale}-post`,
      title: "Sample",
      excerpt: "",
      body: "Placeholder.",
      tags: [],
    }),
  },
  skill: {
    create: { type: "skill", id: SKILL, sortOrder: 1 },
    id: SKILL,
    document: () => ({ name: "NestJS", category: "Backend", projectSlugs: [] }),
  },
  "cv-bullet": {
    create: {
      type: "cv-bullet",
      id: "sample-1",
      parent: { kind: "project", projectId: PROJECT },
      sortOrder: 1,
      importance: 1,
    },
    id: "sample-1",
    document: (locale) => ({ text: `Built a sample (${locale}).` }),
  },
};

const ALL_TYPES = Object.keys(TYPES) as LocalizedType[];

let ports: ContentPorts;
let create: CreateContentItem;
let save: SaveContentRevision;
let publish: PublishContentItem;
let archive: ArchiveContentItem;

beforeEach(() => {
  ports = contentPorts();
  create = new CreateContentItem(ports.uow, ports.ids);
  save = new SaveContentRevision(ports.uow, ports.ids, ports.clock);
  publish = new PublishContentItem(ports.uow, ports.clock);
  archive = new ArchiveContentItem(ports.uow, ports.clock);
});

/** The stored item through the lookup table, as the next use case would load it. */
function stored(type: LocalizedType, id: string) {
  return ports.read(async (scope) => (await LOCALIZED[type].load(scope, id))?.item);
}

/** Creates the CV bullet's parent project, so a bullet can be stored. */
async function createParent(): Promise<void> {
  await create.execute(TYPES.project.create);
}

/** Creates an item and saves es, en and de; returns the version reached (4). */
async function createWithLocales(type: LocalizedType): Promise<number> {
  if (type === "cv-bullet") await createParent();
  let { version } = await create.execute(TYPES[type].create);
  for (const locale of ["es", "en", "de"] as const) {
    ({ version } = await save.execute({
      type,
      id: TYPES[type].id,
      locale,
      document: TYPES[type].document(locale),
      expectedVersion: version,
    } as SaveContentRevisionCommand));
  }
  return version;
}

describe("CreateContentItem", () => {
  it.each(ALL_TYPES)("creates a %s at version 1 with every locale missing", async (type) => {
    if (type === "cv-bullet") await createParent();
    const result = await create.execute(TYPES[type].create);
    expect(result).toEqual({ type, id: TYPES[type].id, version: 1 });
    const item = await stored(type, TYPES[type].id);
    expect(item?.version).toBe(1);
  });

  it("takes a UUIDv7 from the IdGenerator when the command has no id", async () => {
    const result = await create.execute({ type: "skill", sortOrder: 3 });
    expect(result.id).toBe("0199ffff-0000-7000-8000-000000000001");
    expect((await stored("skill", result.id))?.version).toBe(1);
  });

  it("refuses a second profile, even with another id, and keeps the first", async () => {
    await create.execute(TYPES.profile.create);
    await expect(create.execute({ type: "profile" })).rejects.toThrow(ConcurrentModification);
    expect((await stored("profile", PROFILE))?.version).toBe(1);
  });

  it("refuses a command that breaks its schema before anything runs", async () => {
    const bad = { ...TYPES.project.create, kind: "blog" } as unknown as CreateContentItemCommand;
    await expect(create.execute(bad)).rejects.toThrow(ZodError);
    expect(await stored("project", PROJECT)).toBeUndefined();
  });

  it("stores nothing when the domain refuses the layout", async () => {
    await expect(create.execute({ ...TYPES.project.create, slug: "Not A Slug" })).rejects.toThrow(
      SlugInvalid,
    );
    await createParent();
    await expect(create.execute({ ...TYPES["cv-bullet"].create, id: "Bad Id" })).rejects.toThrow(
      IdInvalid,
    );
    expect(await stored("cv-bullet", "Bad Id")).toBeUndefined();
  });
});

describe("SaveContentRevision", () => {
  it.each(ALL_TYPES)("saves an owner revision of a %s and bumps the version", async (type) => {
    if (type === "cv-bullet") await createParent();
    await create.execute(TYPES[type].create);
    ports.clock.advance(5);
    const result = await save.execute({
      type,
      id: TYPES[type].id,
      locale: "en",
      document: TYPES[type].document("en"),
      expectedVersion: 1,
    } as SaveContentRevisionCommand);
    expect(result).toMatchObject({ id: TYPES[type].id, locale: "en", number: 1, version: 2 });
    const item = await stored(type, TYPES[type].id);
    expect(item?.version).toBe(2);
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    if (type === "project") {
      const revision = project?.translations.latest("en");
      expect(revision).toMatchObject({ id: result.revisionId, origin: "owner", number: 1 });
      expect(revision?.createdAt).toEqual(new Date(Date.UTC(2026, 9, 10, 10, 5)));
      expect(project?.translations.stateOf("en")).toBe("draft");
    }
  });

  it("refuses a stale expectedVersion and writes nothing (two tabs, Trace 2b)", async () => {
    await create.execute(TYPES.project.create);
    const tab = { type: "project", id: PROJECT, locale: "en", expectedVersion: 1 } as const;
    await save.execute({ ...tab, document: projectDoc("en", "tab A") });
    await expect(save.execute({ ...tab, document: projectDoc("en", "tab B") })).rejects.toThrow(
      ConcurrentModification,
    );
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.version).toBe(2);
    expect(project?.translations.latest("en")?.document.title).toBe("Sample tab A (en)");
    expect(project?.translations.latest("en")?.number).toBe(1);
  });

  it("writes nothing when the domain refuses a malformed field", async () => {
    await create.execute(TYPES.project.create);
    await expect(
      save.execute({
        type: "project",
        id: PROJECT,
        locale: "en",
        document: { ...projectDoc("en"), slug: "Not A Slug" },
        expectedVersion: 1,
      }),
    ).rejects.toThrow(FieldFormatInvalid);
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.version).toBe(1);
    expect(project?.translations.stateOf("en")).toBe("missing");
  });

  it("fails with ItemNotFound for an unknown id, and for a profile id that is not the stored one", async () => {
    const command = {
      type: "project",
      id: MISSING,
      locale: "en",
      document: projectDoc("en"),
      expectedVersion: 1,
    } as const;
    await expect(save.execute(command)).rejects.toThrow(ItemNotFound);
    await create.execute(TYPES.profile.create);
    await expect(
      save.execute({
        type: "profile",
        id: MISSING,
        locale: "en",
        document: TYPES.profile.document("en"),
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ItemNotFound);
  });

  it("refuses a document of another type before anything runs", async () => {
    await create.execute(TYPES.project.create);
    const mixed = {
      type: "project",
      id: PROJECT,
      locale: "en",
      document: TYPES.skill.document("en"),
      expectedVersion: 1,
    } as unknown as SaveContentRevisionCommand;
    await expect(save.execute(mixed)).rejects.toThrow(ZodError);
  });
});

describe("PublishContentItem", () => {
  it.each(ALL_TYPES)("publishes es, en and de of a %s with no warning", async (type) => {
    const version = await createWithLocales(type);
    const result = await publish.execute({
      type,
      id: TYPES[type].id,
      locales: ["es", "en", "de"],
      expectedVersion: version,
    });
    expect(result.published.map((p) => p.locale)).toEqual(["es", "en", "de"]);
    expect(result.warnings).toEqual([]);
    expect((await stored(type, TYPES[type].id))?.version).toBe(version + 1);
  });

  it("returns the domain's warning when de stays out, and stores the publish", async () => {
    const version = await createWithLocales("project");
    const result = await publish.execute({
      type: "project",
      id: PROJECT,
      locales: ["es", "en"],
      expectedVersion: version,
    });
    expect(result).toEqual({
      itemId: PROJECT,
      published: [
        { locale: "es", revisionId: expect.any(String) },
        { locale: "en", revisionId: expect.any(String) },
      ],
      alreadyPublished: [],
      warnings: [{ code: "optional-locale-unpublished", locale: "de" }],
    });
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.translations.stateOf("en")).toBe("published");
    expect(project?.translations.published("en")?.id).toBe(result.published[1]?.revisionId);
    expect(project?.translations.publishedAt("en")).toEqual(ports.clock.now());
  });

  it("saves nothing and bumps no version when every locale is already live", async () => {
    const version = await createWithLocales("project");
    const command = { type: "project", id: PROJECT, locales: ["es", "en"] } as const;
    await publish.execute({ ...command, expectedVersion: version });
    const again = await publish.execute({ ...command, expectedVersion: version + 1 });
    expect(again.published).toEqual([]);
    expect(again.alreadyPublished).toEqual(["es", "en"]);
    expect((await stored("project", PROJECT))?.version).toBe(version + 1);
  });

  it("writes nothing when a required locale would stay unpublished (D-20)", async () => {
    const version = await createWithLocales("project");
    await expect(
      publish.execute({ type: "project", id: PROJECT, locales: ["es"], expectedVersion: version }),
    ).rejects.toThrow(RequiredLocalesMissing);
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.version).toBe(version);
    expect(project?.translations.stateOf("es")).toBe("draft");
  });

  it("writes nothing when a named locale has no revision", async () => {
    await create.execute(TYPES.project.create);
    await expect(
      publish.execute({ type: "project", id: PROJECT, locales: ["es", "en"], expectedVersion: 1 }),
    ).rejects.toThrow(LocaleIncomplete);
    expect((await stored("project", PROJECT))?.version).toBe(1);
  });

  it("refuses a stale expectedVersion and leaves the pointers as they were", async () => {
    const version = await createWithLocales("project");
    await expect(
      publish.execute({
        type: "project",
        id: PROJECT,
        locales: ["es", "en"],
        expectedVersion: version - 1,
      }),
    ).rejects.toThrow(ConcurrentModification);
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.translations.published("en")).toBeNull();
  });

  it("fails with ItemNotFound for an unknown id", async () => {
    await expect(
      publish.execute({ type: "post", id: MISSING, locales: ["es", "en"], expectedVersion: 1 }),
    ).rejects.toThrow(ItemNotFound);
  });
});

describe("ArchiveContentItem", () => {
  it("archives an item, keeps its revisions and bumps the version", async () => {
    const version = await createWithLocales("project");
    await publish.execute({
      type: "project",
      id: PROJECT,
      locales: ["es", "en"],
      expectedVersion: version,
    });
    const result = await archive.execute({
      type: "project",
      id: PROJECT,
      expectedVersion: version + 1,
    });
    expect(result).toEqual({ id: PROJECT, version: version + 2 });
    const project = await ports.read((scope) => scope.projects.get(PROJECT));
    expect(project?.translations.archivedAt()).toEqual(ports.clock.now());
    expect(project?.translations.published("en")).not.toBeNull();
  });

  it("writes nothing when the item is already archived", async () => {
    await create.execute(TYPES.skill.create);
    await archive.execute({ type: "skill", id: SKILL, expectedVersion: 1 });
    await expect(archive.execute({ type: "skill", id: SKILL, expectedVersion: 2 })).rejects.toThrow(
      InvalidTransition,
    );
    expect((await stored("skill", SKILL))?.version).toBe(2);
  });

  it("refuses the profile, which has no archive, before anything runs", async () => {
    await create.execute(TYPES.profile.create);
    const command = { type: "profile", id: PROFILE, expectedVersion: 1 } as unknown as Parameters<
      ArchiveContentItem["execute"]
    >[0];
    await expect(archive.execute(command)).rejects.toThrow(ZodError);
  });

  it("refuses a stale expectedVersion and an unknown id", async () => {
    await create.execute(TYPES.post.create);
    await expect(archive.execute({ type: "post", id: POST, expectedVersion: 2 })).rejects.toThrow(
      ConcurrentModification,
    );
    expect((await stored("post", POST))?.version).toBe(1);
    await expect(
      archive.execute({ type: "experience-item", id: MISSING, expectedVersion: 1 }),
    ).rejects.toThrow(ItemNotFound);
  });
});

describe("the LOCALIZED lookup table", () => {
  it("counts any stored profile as existing, whatever its id", async () => {
    await create.execute(TYPES.profile.create);
    expect(await ports.read((scope) => LOCALIZED.profile.exists(scope, MISSING))).toBe(true);
    expect(await ports.read((scope) => LOCALIZED.project.exists(scope, PROJECT))).toBe(false);
  });
});
