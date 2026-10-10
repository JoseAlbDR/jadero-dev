import { ProjectRepository } from "../application/project.repository.js";
import type { Project } from "../domain/project.js";
import {
  appendRows,
  InMemoryRecords,
  type LocalizedRecord,
  pointedRevisions,
  type RecordStore,
  storedRevisions,
} from "./in-memory-records.js";
import {
  type ProjectBaseRow,
  type ProjectTranslationRow,
  projectFromRows,
  projectToRows,
} from "./project-rows.js";

/** What the fake stores per project: the rows of its three tables. */
export type ProjectRecord = LocalizedRecord<ProjectBaseRow, ProjectTranslationRow>;

/**
 * The fake adapter of `ProjectRepository` (ADR-009: fakes at ports). It stores the same rows as the
 * Drizzle adapter, through the same mapper, so a document that would not read back from Postgres
 * does not read back here either. Passes the same contract suite as `DrizzleProjectRepository`.
 */
export class InMemoryProjectRepository extends ProjectRepository {
  /** @param records the committed records, or a unit of work's staged view of them. */
  constructor(private readonly records: RecordStore<ProjectRecord> = new InMemoryRecords()) {
    super();
  }

  /**
   * Rebuilds the stored project from the revisions its pointers name.
   * @param id the project's id.
   * @returns the project, or undefined.
   */
  async get(id: string): Promise<Project | undefined> {
    const record = this.records.read(id);
    if (!record) return undefined;
    return projectFromRows(record.base, record.translations, pointedRevisions(record));
  }

  /**
   * Stores the project's rows when it is still at `expectedVersion`, appending its new revisions.
   * @param project the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new project.
   */
  async save(project: Project, expectedVersion: number): Promise<void> {
    const rows = projectToRows(project, expectedVersion + 1);
    this.records.write(expectedVersion, {
      base: rows.base,
      translations: rows.translations,
      revisions: appendRows(
        storedRevisions(this.records, project.id, expectedVersion),
        rows.revisions,
      ),
    });
  }
}
