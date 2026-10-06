import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Widget } from "../domain/widget.js";
import type { WidgetRepository } from "./widget.repository.js";
import type { WidgetsUnitOfWork } from "./widgets.unit-of-work.js";

/** What the unit of work contract needs for each test: the unit of work and a reader outside it. */
export interface WidgetsUnitOfWorkFixture {
  /** The unit of work under test. */
  readonly unitOfWork: WidgetsUnitOfWork;
  /** A repository outside any transaction, over the same storage: it sees only committed data. */
  readonly widgets: WidgetRepository;
}

/**
 * The contract every `WidgetsUnitOfWork` adapter passes (ADR-009, WP-10 D6): committed work is
 * visible afterwards, work that throws leaves nothing and its error reaches the caller unchanged,
 * and a reader outside the work sees none of its writes before the commit (isolation: a fake that
 * writes straight to storage and undoes on throw fails here).
 * The in-memory fake runs it in `pnpm verify`, the Drizzle adapter on Postgres in `pnpm test:int`.
 * @param name the adapter's name, shown in the test report.
 * @param make builds a unit of work and a reader over empty storage for each test.
 */
export function widgetsUnitOfWorkContract(
  name: string,
  make: () => WidgetsUnitOfWorkFixture | Promise<WidgetsUnitOfWorkFixture>,
): void {
  describe(`WidgetsUnitOfWork contract: ${name}`, () => {
    it("commits the work: the write is visible through the repository afterwards", async () => {
      const { unitOfWork, widgets } = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      const result = await unitOfWork.run(async (scope) => {
        await scope.widgets.save(widget);
        return "done";
      });
      expect(result).toBe("done");
      expect(await widgets.findById(widget.id)).toEqual(widget);
    });

    it("lets the work read its own write before the commit", async () => {
      const { unitOfWork } = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      const seen = await unitOfWork.run(async (scope) => {
        await scope.widgets.save(widget);
        return scope.widgets.findById(widget.id);
      });
      expect(seen).toEqual(widget);
    });

    it("discards everything when the work throws, and rethrows the same error", async () => {
      const { unitOfWork, widgets } = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      const failure = new Error("rule checked too late");
      await expect(
        unitOfWork.run(async (scope) => {
          await scope.widgets.save(widget);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await widgets.findById(widget.id)).toBeUndefined();
    });

    it("hides the work's writes from a reader outside it until the commit", async () => {
      const { unitOfWork, widgets } = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      let seenOutside: Widget | undefined;
      await unitOfWork.run(async (scope) => {
        await scope.widgets.save(widget);
        seenOutside = await widgets.findById(widget.id);
      });
      expect(seenOutside).toBeUndefined();
      expect(await widgets.findById(widget.id)).toEqual(widget);
    });
  });
}
