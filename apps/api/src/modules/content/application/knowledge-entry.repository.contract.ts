import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { KnowledgeEntry } from "../domain/knowledge-entry.js";
import {
  ALL_CHECKED,
  at,
  entryDocument,
  entryProvenance,
  newEntry,
} from "./content.contract-fixtures.js";
import type { KnowledgeEntryRepository } from "./knowledge-entry.repository.js";

/** The private fields of the entry format (D-67), never part of a stored document. */
const PRIVATE_FIELDS = ["sources", "conflicts", "publicNames", "public_names", "confidence"];

/**
 * The contract every `KnowledgeEntryRepository` adapter passes (ADR-009, D4, D5, D-67): the
 * in-memory fake in `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`. A reload
 * equals what was saved, the version check refuses a stale save and writes nothing, approval keeps
 * its revision and checklist, and each revision's provenance is stored apart from its document.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a repository for each test.
 */
export function knowledgeEntryRepositoryContract(
  name: string,
  make: () => KnowledgeEntryRepository | Promise<KnowledgeEntryRepository>,
): void {
  /** Creates and approves an entry in one save (the importer's path); returns it reloaded. */
  async function approved(repository: KnowledgeEntryRepository): Promise<KnowledgeEntry> {
    const entry = newEntry();
    entry.approve(entry.latest().id, ALL_CHECKED, at(1));
    await repository.save(entry, 0);
    return (await repository.get(entry.id)) as KnowledgeEntry;
  }

  describe(`KnowledgeEntryRepository contract: ${name}`, () => {
    it("returns undefined for an unknown id", async () => {
      const repository = await make();
      expect(await repository.get(`kb-unknown-${randomUUID().slice(0, 8)}`)).toBeUndefined();
    });

    it("reloads a new entry equal to its snapshot, at version 1", async () => {
      const repository = await make();
      const entry = newEntry();
      entry.submit();
      await repository.save(entry, 0);
      const reloaded = await repository.get(entry.id);
      expect(reloaded?.snapshot()).toEqual({ ...entry.snapshot(), version: 1 });
      expect(reloaded?.state).toBe("in_review");
    });

    it("refuses a stale version with ConcurrentModification and writes nothing", async () => {
      const repository = await make();
      const loaded = await approved(repository);
      const before = loaded.snapshot();
      loaded.withdraw(at(5));
      await expect(repository.save(loaded, 4)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await repository.get(loaded.id))?.snapshot()).toEqual(before);
    });

    it("refuses a create of an id that exists", async () => {
      const repository = await make();
      const existing = await approved(repository);
      await expect(repository.save(existing, 0)).rejects.toBeInstanceOf(ConcurrentModification);
    });

    it("keeps the approved revision, its time and its checklist after a reload", async () => {
      const repository = await make();
      const reloaded = await approved(repository);
      expect(reloaded.state).toBe("approved");
      expect(reloaded.approvedRevisionId).toBe(reloaded.latest().id);
      expect(reloaded.approval).toEqual({
        revisionId: reloaded.latest().id,
        approvedAt: at(1),
        checklist: ALL_CHECKED,
      });
      expect(reloaded.cvBullet).toBe("placeholder-1");
    });

    it("stores each revision's provenance with it, never inside its document", async () => {
      const repository = await make();
      const entry = newEntry();
      entry.approve(entry.latest().id, ALL_CHECKED, at(1));
      const first = entry.latest().id;
      const second = entry.saveRevision(
        entryDocument("Second"),
        entryProvenance("second notes"),
        "machine",
        randomUUID(),
        at(2),
      ).id;
      await repository.save(entry, 0);
      const reloaded = await repository.get(entry.id);
      // Both new revisions were inserted: the approved one stays live, the newer one is a draft.
      expect(reloaded?.approvedRevisionId).toBe(first);
      expect(reloaded?.latest().id).toBe(second);
      expect(reloaded?.state).toBe("draft");
      expect(reloaded?.revision(first)?.provenance).toEqual(entryProvenance());
      expect(reloaded?.revision(second)?.provenance).toEqual(entryProvenance("second notes"));
      expect(reloaded?.revision(second)?.origin).toBe("machine");
      for (const id of [first, second]) {
        const keys = Object.keys(reloaded?.revision(id)?.document ?? {});
        expect(keys.filter((key) => PRIVATE_FIELDS.includes(key))).toEqual([]);
      }
    });

    it("stores a withdraw: no approval, no live bullet, the withdrawal time", async () => {
      const repository = await make();
      const loaded = await approved(repository);
      loaded.withdraw(at(6));
      await repository.save(loaded, 1);
      const reloaded = await repository.get(loaded.id);
      expect(reloaded?.state).toBe("withdrawn");
      expect(reloaded?.approval).toBeNull();
      expect(reloaded?.cvBullet).toBeNull();
      expect(reloaded?.withdrawnAt).toEqual(at(6));
      expect(reloaded?.snapshot()).toEqual({ ...loaded.snapshot(), version: 2 });
    });
  });
}
