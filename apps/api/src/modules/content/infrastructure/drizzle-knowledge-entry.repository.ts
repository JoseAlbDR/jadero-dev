import { DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, max, or, type SQL } from "drizzle-orm";
import { KnowledgeEntryRepository } from "../application/knowledge-entry.repository.js";
import type { KnowledgeEntry } from "../domain/knowledge-entry.js";
import { type ContentDatabase, compareAndSet } from "./drizzle-content-rows.js";
import {
  knowledgeEntries,
  knowledgeEntryProvenance,
  knowledgeEntryRevisions,
} from "./knowledge-entry.schema.js";
import { knowledgeEntryFromRows, knowledgeEntryToRows } from "./knowledge-entry-rows.js";

/**
 * The Drizzle adapter of `KnowledgeEntryRepository` (ADR-005), the owner's side: it reads and
 * writes the private provenance, naming its columns (never `SELECT *`). On the pool (`DRIZZLE`) for
 * display reads, or on a transaction's connection inside `DrizzleContentUnitOfWork.run`. Passes the
 * same contract suite as the in-memory fake.
 */
@Injectable()
export class DrizzleKnowledgeEntryRepository extends KnowledgeEntryRepository {
  constructor(@Inject(DRIZZLE) private readonly db: ContentDatabase) {
    super();
  }

  /**
   * Reads the root row, then in one query the latest revision and the approved one (when older),
   * each joined to its provenance row.
   * @param id the entry's human id.
   * @returns the entry, or undefined when no row has this id.
   */
  async get(id: string): Promise<KnowledgeEntry | undefined> {
    const e = knowledgeEntries;
    const [base] = await this.db
      .select({
        id: e.id,
        version: e.version,
        state: e.state,
        approvedRevisionId: e.approvedRevisionId,
        approvedAt: e.approvedAt,
        approvalChecklist: e.approvalChecklist,
        cvBullet: e.cvBullet,
        withdrawnAt: e.withdrawnAt,
        deletedAt: e.deletedAt,
      })
      .from(e)
      .where(eq(e.id, id))
      .limit(1);
    if (!base) return undefined;

    const r = knowledgeEntryRevisions;
    const p = knowledgeEntryProvenance;
    const latestNumber = this.db
      .select({ number: max(r.number) })
      .from(r)
      .where(eq(r.entryId, id));
    const wanted: SQL | undefined = or(
      eq(r.number, latestNumber),
      base.approvedRevisionId ? eq(r.id, base.approvedRevisionId) : undefined,
    );
    const loaded = await this.db
      .select({
        revision: {
          id: r.id,
          entryId: r.entryId,
          number: r.number,
          document: r.document,
          origin: r.origin,
          createdAt: r.createdAt,
        },
        provenance: {
          revisionId: p.revisionId,
          sources: p.sources,
          conflicts: p.conflicts,
          publicNames: p.publicNames,
          confidence: p.confidence,
        },
      })
      .from(r)
      .leftJoin(p, eq(p.revisionId, r.id))
      .where(and(eq(r.entryId, id), wanted));
    return knowledgeEntryFromRows(base, loaded);
  }

  /**
   * Saves in this order, on one connection: (1) the compare-and-set on `content.knowledge_entries`
   * (a create inserts the row as a draft with no approval), which takes the row lock; (2) `INSERT`
   * of every unsaved revision, then of their provenance rows; (3) the approval columns and
   * `cv_bullet` on the root. The approval goes last because its foreign key and the
   * approved-state CHECK need the approved revision's row, which step 2 may have just inserted (an
   * entry created and approved in one save, as the importer of WP-35 does).
   * @param entry the aggregate after the use case changed it.
   * @param expectedVersion the version the caller loaded, 0 for a new entry.
   */
  async save(entry: KnowledgeEntry, expectedVersion: number): Promise<void> {
    const rows = knowledgeEntryToRows(entry, expectedVersion + 1);
    const { id, version: _version, ...state } = rows.base;
    await compareAndSet(this.db, knowledgeEntries, id, expectedVersion, { id, state: "draft" }, {});
    if (rows.revisions.length > 0) {
      await this.db
        .insert(knowledgeEntryRevisions)
        .values(rows.revisions.map((row) => ({ ...row })));
      await this.db
        .insert(knowledgeEntryProvenance)
        .values(rows.provenance.map((row) => ({ ...row })));
    }
    await this.db.update(knowledgeEntries).set(state).where(eq(knowledgeEntries.id, id));
  }
}
