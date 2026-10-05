import { type Database, DRIZZLE } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { WidgetRepository } from "../application/widget.repository.js";
import { Widget } from "../domain/widget.js";
import { widgets } from "./widget.schema.js";

/**
 * The real adapter of the port (ADR-005: Drizzle behind repositories). It holds a Drizzle instance:
 * the pool's (`DRIZZLE`) when Nest injects it, for display reads outside a transaction, or a
 * transaction's when `DrizzleWidgetsUnitOfWork` builds it inside `run`. Passes the same contract
 * suite as the in-memory fake. The parameter accepts Drizzle with any schema (the service's
 * `DRIZZLE`, or the unit of work's, typed with this module's tables): it uses only the query
 * builder, never the relational `db.query` API.
 */
@Injectable()
export class DrizzleWidgetRepository extends WidgetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database<Record<string, unknown>>) {
    super();
  }

  /**
   * Reads one row and rebuilds the aggregate from it.
   * @param id the widget's id, a UUID.
   * @returns the widget, or undefined when no row has this id.
   */
  async findById(id: string): Promise<Widget | undefined> {
    const [row] = await this.db
      .select({ id: widgets.id, name: widgets.name })
      .from(widgets)
      .where(eq(widgets.id, id))
      .limit(1);
    return row ? Widget.reconstitute(row.id, row.name) : undefined;
  }

  /**
   * Inserts the widget, or replaces its name when the id exists (`ON CONFLICT (id) DO UPDATE`), so
   * saving twice never duplicates. `created_at` keeps the first insert's time.
   * @param widget the widget to store.
   */
  async save(widget: Widget): Promise<void> {
    await this.db
      .insert(widgets)
      .values({ id: widget.id, name: widget.name })
      .onConflictDoUpdate({ target: widgets.id, set: { name: widget.name } });
  }
}
