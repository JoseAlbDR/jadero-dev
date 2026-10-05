import { WidgetNameInvalid } from "./widget.errors.js";

/**
 * The aggregate: plain TypeScript, no Nest, no database, no npm package (rule
 * domain-imports-only-domain). It guards its own rules; nothing outside can put it in a bad state.
 */
export class Widget {
  private constructor(
    readonly id: string,
    private currentName: string,
  ) {}

  /**
   * Creates a widget after checking the name rule.
   * @param id the identity, chosen by the caller (a use case).
   * @param name 1 to 60 characters after trimming.
   * @throws {WidgetNameInvalid} when the name breaks the rule.
   */
  static create(id: string, name: string): Widget {
    return new Widget(id, Widget.checkedName(name));
  }

  /**
   * Rebuilds a widget that was already stored (reconstitution): the repository's way back from a
   * row to the aggregate. It does not re-check the name rule: the stored name passed it when the
   * widget was saved, and a rule that tightens later must not make existing rows unreadable.
   * @param id the stored identity.
   * @param name the stored name.
   * @returns the widget as it was saved.
   */
  static reconstitute(id: string, name: string): Widget {
    return new Widget(id, name);
  }

  /** The current name. */
  get name(): string {
    return this.currentName;
  }

  /**
   * Renames the widget under the same rule as creation.
   * @throws {WidgetNameInvalid} when the new name breaks the rule.
   */
  rename(name: string): void {
    this.currentName = Widget.checkedName(name);
  }

  private static checkedName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 60) throw new WidgetNameInvalid(name);
    return trimmed;
  }
}
