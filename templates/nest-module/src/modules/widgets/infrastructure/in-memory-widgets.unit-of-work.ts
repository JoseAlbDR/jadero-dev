import { Injectable } from "@nestjs/common";
import { WidgetRepository } from "../application/widget.repository.js";
import { type WidgetsScope, WidgetsUnitOfWork } from "../application/widgets.unit-of-work.js";
import { Widget } from "../domain/widget.js";
import { InMemoryWidgetRepository, type WidgetRow } from "./in-memory-widget.repository.js";

/**
 * The transaction's view of the fake: writes go to a staged copy, reads see the staged copy first
 * and the committed rows after it (read your own writes, as inside a Postgres transaction).
 */
class StagedWidgetRepository extends WidgetRepository {
  readonly staged = new Map<string, WidgetRow>();

  constructor(private readonly committed: InMemoryWidgetRepository) {
    super();
  }

  /**
   * The staged widget when this transaction wrote it, else the committed one.
   * @param id the widget's id.
   * @returns the widget, or undefined.
   */
  async findById(id: string): Promise<Widget | undefined> {
    const row = this.staged.get(id);
    return row ? Widget.reconstitute(row.id, row.name) : this.committed.findById(id);
  }

  /**
   * Stages a copy of the widget; nothing reaches the committed rows before the commit.
   * @param widget the widget to store.
   */
  async save(widget: Widget): Promise<void> {
    this.staged.set(widget.id, { id: widget.id, name: widget.name });
  }
}

/**
 * The fake unit of work (ADR-009): `work` runs on a staged copy of its writes, applied to the
 * in-memory repository in one synchronous step only when `work` resolves, and dropped when it
 * throws. Passes the same contract suite as `DrizzleWidgetsUnitOfWork`. Shares its storage with
 * the module's `WidgetRepository` binding, so a read outside `run` sees what `run` committed.
 */
@Injectable()
export class InMemoryWidgetsUnitOfWork extends WidgetsUnitOfWork {
  constructor(private readonly committed: InMemoryWidgetRepository) {
    super();
  }

  /**
   * Runs `work` on staged writes; commits them when it resolves, discards them when it throws.
   * @param work the use case's writes.
   * @returns what `work` returned, after the commit.
   */
  async run<T>(work: (scope: WidgetsScope) => Promise<T>): Promise<T> {
    const widgets = new StagedWidgetRepository(this.committed);
    const result = await work({ widgets });
    this.committed.apply(widgets.staged.values());
    return result;
  }
}
