import type {
  ExperienceListDto,
  KnowledgeEntryDto,
  KnowledgeEntryListDto,
  Locale,
  PostCursorPosition,
  PostDto,
  PostPageDto,
  ProfileDto,
  ProjectDto,
  ProjectKind,
  ProjectListDto,
  SkillListDto,
} from "@jadero/contracts";
import { ContentQueries } from "../src/modules/content/application/content-queries.js";

// A fake of the content read port for the HTTP tests that need no database: the controllers,
// the parameter schemas, the response schemas, the cache headers and 304, on canned placeholder
// content. The SQL behind the port is proved on Postgres in content-public.int.test.ts.

const englishProject: ProjectDto = {
  slug: "sample-project",
  locale: "en",
  kind: "project",
  title: "Sample project",
  summary: "A placeholder project.",
  stackTags: ["NestJS"],
  featured: false,
  alternates: { es: "proyecto-de-ejemplo", en: "sample-project" },
  body: "## Problem\n\nPlaceholder.",
  repoUrl: null,
  demoUrl: null,
};

const germanProject: ProjectDto = {
  ...englishProject,
  slug: "beispielprojekt",
  locale: "de",
  title: "Beispielprojekt",
  alternates: { ...englishProject.alternates, de: "beispielprojekt" },
};

/** Canned content; records the last post cursor it was given. */
export class FakeContentQueries extends ContentQueries {
  lastCursor: PostCursorPosition | undefined;

  /** {@inheritDoc ContentQueries.profile} */
  async profile(locale: Locale): Promise<ProfileDto | undefined> {
    return {
      locale,
      name: "Alex Example",
      headline: "Backend engineer",
      summary: "Placeholder.",
      links: [{ kind: "website", url: "https://example.com" }],
    };
  }

  /** {@inheritDoc ContentQueries.experience} */
  async experience(): Promise<ExperienceListDto> {
    return { items: [] };
  }

  /** {@inheritDoc ContentQueries.projects} */
  async projects(locale: Locale, kind?: ProjectKind): Promise<ProjectListDto> {
    const items = locale === "de" ? [germanProject, englishProject] : [englishProject];
    return { items: items.filter((item) => kind === undefined || item.kind === kind) };
  }

  /** {@inheritDoc ContentQueries.project} */
  async project(locale: Locale, slug: string): Promise<ProjectDto | undefined> {
    if (locale === "de" && slug === germanProject.slug) return germanProject;
    if (slug === englishProject.slug) return englishProject;
    return undefined;
  }

  /** {@inheritDoc ContentQueries.posts} */
  async posts(_locale: Locale, after?: PostCursorPosition): Promise<PostPageDto> {
    this.lastCursor = after;
    return { items: [], nextCursor: null };
  }

  /** {@inheritDoc ContentQueries.post} */
  async post(): Promise<PostDto | undefined> {
    return undefined;
  }

  /** {@inheritDoc ContentQueries.skills} */
  async skills(): Promise<SkillListDto> {
    return { items: [] };
  }

  /** {@inheritDoc ContentQueries.workLog} */
  async workLog(): Promise<KnowledgeEntryListDto> {
    return { items: [] };
  }

  /**
   * Returns an entry that carries a private field by mistake, as a buggy query would: the response
   * schema must drop it.
   */
  async workEntry(entryId: string): Promise<KnowledgeEntryDto | undefined> {
    if (entryId !== "kb-sample-entry") return undefined;
    const leaked = {
      id: entryId,
      title: "Sample entry",
      type: "feature",
      domain: "platform",
      period: { from: "2025-03", to: null },
      role: "sole author",
      stack: ["NestJS"],
      patterns: ["transactional outbox"],
      indexable: true,
      cvBullet: null,
      related: [],
      sections: [
        { key: "summary", body: "Placeholder." },
        { key: "problem", body: "Placeholder." },
        { key: "whatHeBuilt", body: "Placeholder." },
      ],
      questions: ["What is this?"],
      sources: ["a private note"],
    } satisfies KnowledgeEntryDto & { sources: string[] };
    return leaked;
  }
}
