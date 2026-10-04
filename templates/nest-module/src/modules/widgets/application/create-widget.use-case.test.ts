import { describe, expect, it } from "vitest";
import { WidgetNameInvalid } from "../domain/widget.errors.js";
import type { Widget } from "../domain/widget.js";
import { CreateWidget } from "./create-widget.use-case.js";
import { IdGenerator } from "./id-generator.js";
import { WidgetRepository } from "./widget.repository.js";

// Fakes implement the ports right here: application/ never imports infrastructure/, tests included.
class FakeWidgets extends WidgetRepository {
  readonly saved = new Map<string, Widget>();

  async findById(id: string): Promise<Widget | undefined> {
    return this.saved.get(id);
  }

  async save(widget: Widget): Promise<void> {
    this.saved.set(widget.id, widget);
  }
}

class FixedIds extends IdGenerator {
  next(): string {
    return "w-1";
  }
}

describe("CreateWidget", () => {
  it("stores the widget through the port and returns it", async () => {
    const widgets = new FakeWidgets();
    const result = await new CreateWidget(widgets, new FixedIds()).execute({ name: " lamp " });
    expect(result).toEqual({ id: "w-1", name: "lamp" });
    expect((await widgets.findById("w-1"))?.name).toBe("lamp");
  });

  it("stores nothing when the domain rejects the name", async () => {
    const widgets = new FakeWidgets();
    await expect(new CreateWidget(widgets, new FixedIds()).execute({ name: "" })).rejects.toThrow(
      WidgetNameInvalid,
    );
    expect(await widgets.findById("w-1")).toBeUndefined();
  });
});
