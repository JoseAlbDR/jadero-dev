import { Injectable } from "@nestjs/common";
import { WidgetRepository } from "../application/widget.repository.js";
import type { Widget } from "../domain/widget.js";

/**
 * An adapter for the port, keeping the template runnable. A Drizzle adapter (WP-10) replaces it in
 * a service; use-case tests use their own fake of the port (ADR-009: fakes at ports, not mocks).
 */
@Injectable()
export class InMemoryWidgetRepository extends WidgetRepository {
  private readonly widgets = new Map<string, Widget>();

  async findById(id: string): Promise<Widget | undefined> {
    return this.widgets.get(id);
  }

  async save(widget: Widget): Promise<void> {
    this.widgets.set(widget.id, widget);
  }
}
