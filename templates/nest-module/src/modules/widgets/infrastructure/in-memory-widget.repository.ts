import { Injectable } from "@nestjs/common";
import { WidgetRepository } from "../application/widget.repository.js";
import { Widget } from "../domain/widget.js";

/** What the fake stores per widget: a copy of its state, like a table row. */
export interface WidgetRow {
  readonly id: string;
  readonly name: string;
}

/**
 * The fake adapter of the port (ADR-009: fakes at ports, not mocks), keeping the template runnable
 * without a database. It stores copies, not the aggregate itself, so a widget changed after `save`
 * is not changed in storage until it is saved again: the same as a table. Passes the same contract
 * suite as `DrizzleWidgetRepository`.
 */
@Injectable()
export class InMemoryWidgetRepository extends WidgetRepository {
  private readonly rows = new Map<string, WidgetRow>();

  /**
   * Rebuilds the stored widget.
   * @param id the widget's id.
   * @returns the widget, or undefined.
   */
  async findById(id: string): Promise<Widget | undefined> {
    const row = this.rows.get(id);
    return row ? Widget.reconstitute(row.id, row.name) : undefined;
  }

  /**
   * Inserts or replaces the widget's row.
   * @param widget the widget to store.
   */
  async save(widget: Widget): Promise<void> {
    this.apply([{ id: widget.id, name: widget.name }]);
  }

  /**
   * Writes rows in one synchronous step, so no other caller sees half of them: the fake unit of
   * work's commit.
   * @param rows the rows to insert or replace.
   */
  apply(rows: Iterable<WidgetRow>): void {
    for (const row of rows) this.rows.set(row.id, { ...row });
  }
}
