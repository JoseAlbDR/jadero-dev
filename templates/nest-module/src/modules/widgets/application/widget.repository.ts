import type { Widget } from "../domain/widget.js";

/**
 * The port: what the use cases need from storage, as an abstract class so it is also the DI token
 * (ADR-003). Adapters in infrastructure/ implement it; the module binds one to it.
 */
export abstract class WidgetRepository {
  /** The widget with this id, or undefined. */
  abstract findById(id: string): Promise<Widget | undefined>;

  /** Inserts or replaces the widget. */
  abstract save(widget: Widget): Promise<void>;
}
