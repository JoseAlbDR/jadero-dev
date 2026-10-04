/** A domain rule was broken; the presentation layer maps it to an HTTP status. */
export class WidgetNameInvalid extends Error {
  constructor(readonly attempted: string) {
    super("A widget name must have 1 to 60 characters.");
    this.name = "WidgetNameInvalid";
  }
}
