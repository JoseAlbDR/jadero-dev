import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ProjectRepository } from "../application/project.repository.js";
import type { Project } from "../domain/project.js";
import { projectRevisions, projects, projectTranslations } from "./content.schema.js";
import {
  type ContentDatabase,
  compareAndSet,
  DrizzleLocalizedRows,
} from "./drizzle-content-rows.js";
import { type ProjectTranslationRow, projectFromRows, projectToRows } from "./project-rows.js";

/**
 * The Drizzle adapter of `ProjectRepository` (ADR-005), on the pool (`DRIZZLE`) for display reads or
 * on a transaction's connection when `DrizzleContentUnitOfWork` builds it inside `run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleProjectRepository extends ProjectRepository {
  private readonly localized: DrizzleLocalizedRows<ProjectTranslationRow>;

  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
    this.localized = new DrizzleLocalizedRows(this.db, projectRevisions, projectTranslations, {
      publishedSlug: projectTranslations.publishedSlug,
    });
  }

  /**
   * Reads the root row, the translation rows and the revisions they point at, then rebuilds the
   * project through the shared mapper.
   * @param id the project's id.
   * @returns the project, or undefined when no row has this id.
   */
  async get(id: string): Promise<Project | undefined> {
    const [base] = await this.db
      .select({
        id: projects.id,
        slug: projects.slug,
        kind: projects.kind,
        featured: projects.featured,
        sortOrder: projects.sortOrder,
        archivedAt: projects.archivedAt,
        version: projects.version,
      })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!base) return undefined;
    const { translations, revisions } = await this.localized.load(id);
    return projectFromRows(base, translations, revisions);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.projects` with the
   * layout fields, which takes the row lock; (2) `INSERT` of every unsaved revision; (3) the upsert
   * of every locale's pointers and published slug, after the revisions they point at.
   * @param project the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new project.
   */
  async save(project: Project, expectedVersion: number): Promise<void> {
    const rows = projectToRows(project, expectedVersion + 1);
    const { id, version: _version, ...layout } = rows.base;
    await compareAndSet(this.db, projects, id, expectedVersion, { id, ...layout }, layout);
    await this.localized.insertRevisions(rows.revisions);
    await this.localized.upsertTranslations(rows.translations);
  }
}
