import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Widget } from "../domain/widget.js";
import type { WidgetRepository } from "./widget.repository.js";

/**
 * The contract every `WidgetRepository` adapter passes (ADR-009, WP-10 D5): the in-memory one in
 * `pnpm verify`, the Drizzle one on real Postgres in `pnpm test:int`. A fake that passes the same
 * suite as the real adapter can be trusted in use-case tests. Ids are UUIDs, as the table needs.
 * @param name the adapter's name, shown in the test report.
 * @param make builds an empty repository for each test.
 */
export function widgetRepositoryContract(
  name: string,
  make: () => WidgetRepository | Promise<WidgetRepository>,
): void {
  describe(`WidgetRepository contract: ${name}`, () => {
    it("returns an equal widget after save", async () => {
      const repository = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      await repository.save(widget);
      expect(await repository.findById(widget.id)).toEqual(widget);
    });

    it("returns undefined for an unknown id", async () => {
      const repository = await make();
      expect(await repository.findById(randomUUID())).toBeUndefined();
    });

    it("replaces the widget when it is saved twice, never duplicates it", async () => {
      const repository = await make();
      const widget = Widget.create(randomUUID(), "lamp");
      await repository.save(widget);
      widget.rename("desk lamp");
      await repository.save(widget);
      const found = await repository.findById(widget.id);
      expect(found?.name).toBe("desk lamp");
      expect(found).toEqual(widget);
    });
  });
}
