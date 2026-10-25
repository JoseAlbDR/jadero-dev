import { knowledgeEntryApprovedV1, knowledgeEntryWithdrawnV1 } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ConcurrentModification } from "../domain/content.errors.js";
import { newProject, saveProjectRevision } from "./content.contract-fixtures.js";
import type { ContentUnitOfWork } from "./content.unit-of-work.js";
import { CONTENT_EVENT_SOURCE, type WrittenContentEvent } from "./content-event-writer.js";
import type { KnowledgeEntryApprovedData, KnowledgeEntryWithdrawnData } from "./content-events.js";

/** What the event writer contract needs for each test: a unit of work over an empty outbox. */
export interface ContentEventWriterFixture {
  /** The unit of work whose scope carries the writer under test. */
  readonly unitOfWork: ContentUnitOfWork;
  /** The committed outbox, read outside any run: it shows only what a run committed. */
  outbox(): Promise<readonly WrittenContentEvent[]>;
}

const withdrawn: KnowledgeEntryWithdrawnData = {
  entryId: "kb-contract-entry",
  locale: "en",
  revision: { id: "01a1a10a-9e8d-7c6b-8a59-4f3e2d1c0b0a", number: 1 },
  reason: "withdrawn",
  at: "2026-10-25T10:00:00.000Z",
};

const deleted: KnowledgeEntryWithdrawnData = { ...withdrawn, reason: "deleted" };

/**
 * The contract every `ContentEventWriter` adapter passes, through the unit of work that owns it
 * (ADR-009, ADR-012, WP-14 D1): a committed run leaves each written event once, with its routing
 * key, the content source and its data; a run that throws, or whose save loses the version check,
 * leaves no event; a reader outside sees nothing before the commit; data that breaks its contract
 * is refused before anything is written. The in-memory fake runs it in `pnpm verify`, the Drizzle
 * adapter on Postgres in `pnpm test:int`.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a unit of work and an outbox reader over an empty outbox for each test.
 */
export function contentEventWriterContract(
  name: string,
  make: () => ContentEventWriterFixture | Promise<ContentEventWriterFixture>,
): void {
  describe(`ContentEventWriter contract: ${name}`, () => {
    it("a committed run leaves each event once, with its routing key, source and data", async () => {
      const { unitOfWork, outbox } = await make();
      const written = await unitOfWork.run(async (scope) => [
        await scope.events.write(knowledgeEntryWithdrawnV1, withdrawn),
        await scope.events.write(knowledgeEntryWithdrawnV1, deleted),
      ]);
      const events = await outbox();
      expect(events).toHaveLength(2);
      for (const envelope of written) {
        expect(events).toContainEqual({
          routingKey: knowledgeEntryWithdrawnV1.routingKey,
          envelope: expect.objectContaining({
            id: envelope.id,
            type: knowledgeEntryWithdrawnV1.type,
            source: CONTENT_EVENT_SOURCE,
            data: envelope.data,
          }),
        });
      }
      expect(written.map((envelope) => envelope.data.reason)).toEqual(["withdrawn", "deleted"]);
    });

    it("shows nothing to a reader outside before the commit", async () => {
      const { unitOfWork, outbox } = await make();
      const inside = await unitOfWork.run(async (scope) => {
        await scope.events.write(knowledgeEntryWithdrawnV1, withdrawn);
        return outbox();
      });
      expect(inside).toEqual([]);
      expect(await outbox()).toHaveLength(1);
    });

    it("a run that throws leaves no event, and its error reaches the caller unchanged", async () => {
      const { unitOfWork, outbox } = await make();
      const failure = new Error("the use case failed after writing its event");
      await expect(
        unitOfWork.run(async (scope) => {
          await scope.events.write(knowledgeEntryWithdrawnV1, withdrawn);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await outbox()).toEqual([]);
    });

    it("a version conflict in the same run rolls the event back with the rest", async () => {
      const { unitOfWork, outbox } = await make();
      const project = newProject();
      saveProjectRevision(project, "es");
      await unitOfWork.run((scope) => scope.projects.save(project, 0));
      await expect(
        unitOfWork.run(async (scope) => {
          const loaded = await scope.projects.get(project.id);
          if (!loaded) throw new Error("the project was not stored");
          saveProjectRevision(loaded, "en");
          await scope.events.write(knowledgeEntryWithdrawnV1, withdrawn);
          await scope.projects.save(loaded, 7);
        }),
      ).rejects.toBeInstanceOf(ConcurrentModification);
      expect(await outbox()).toEqual([]);
    });

    it("refuses data that breaks its contract, and writes nothing", async () => {
      const { unitOfWork, outbox } = await make();
      const broken = { ...withdrawn, reason: "archived" } as unknown as KnowledgeEntryWithdrawnData;
      await expect(
        unitOfWork.run((scope) => scope.events.write(knowledgeEntryWithdrawnV1, broken)),
      ).rejects.toBeInstanceOf(ZodError);
      const incomplete = { entryId: "kb-contract-entry" } as unknown as KnowledgeEntryApprovedData;
      await expect(
        unitOfWork.run((scope) => scope.events.write(knowledgeEntryApprovedV1, incomplete)),
      ).rejects.toBeInstanceOf(ZodError);
      expect(await outbox()).toEqual([]);
    });
  });
}
