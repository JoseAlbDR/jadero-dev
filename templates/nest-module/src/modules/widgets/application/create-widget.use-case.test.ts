import { describe, expect, it } from "vitest";
import { WidgetNameInvalid } from "../domain/widget.errors.js";
import type { Widget } from "../domain/widget.js";
import { CreateWidget } from "./create-widget.use-case.js";
import { IdGenerator } from "./id-generator.js";
import { widgetRepositoryContract } from "./widget.repository.contract.js";
import { WidgetRepository } from "./widget.repository.js";
import { widgetsUnitOfWorkContract } from "./widgets.unit-of-work.contract.js";
import { type WidgetsScope, WidgetsUnitOfWork } from "./widgets.unit-of-work.js";

// Fakes implement the ports right here: application/ never imports infrastructure/, tests included.
// They pass the same contract suites as the real adapters (below), so these tests can trust them.
class FakeWidgets extends WidgetRepository {
  constructor(readonly saved = new Map<string, Widget>()) {
    super();
  }

  async findById(id: string): Promise<Widget | undefined> {
    return this.saved.get(id);
  }

  async save(widget: Widget): Promise<void> {
    this.saved.set(widget.id, widget);
  }
}

// Works on a staged copy and keeps it only when the work resolves, like a transaction.
class FakeUnitOfWork extends WidgetsUnitOfWork {
  constructor(readonly widgets: FakeWidgets) {
    super();
  }

  async run<T>(work: (scope: WidgetsScope) => Promise<T>): Promise<T> {
    const staged = new FakeWidgets(new Map(this.widgets.saved));
    const result = await work({ widgets: staged });
    for (const [id, widget] of staged.saved) this.widgets.saved.set(id, widget);
    return result;
  }
}

class FixedIds extends IdGenerator {
  next(): string {
    return "w-1";
  }
}

widgetRepositoryContract("use-case test fake", () => new FakeWidgets());
widgetsUnitOfWorkContract("use-case test fake", () => {
  const widgets = new FakeWidgets();
  return { unitOfWork: new FakeUnitOfWork(widgets), widgets };
});

describe("CreateWidget", () => {
  it("stores the widget inside the unit of work and returns it", async () => {
    const widgets = new FakeWidgets();
    const result = await new CreateWidget(new FakeUnitOfWork(widgets), new FixedIds()).execute({
      name: " lamp ",
    });
    expect(result).toEqual({ id: "w-1", name: "lamp" });
    expect((await widgets.findById("w-1"))?.name).toBe("lamp");
  });

  it("stores nothing when the domain rejects the name", async () => {
    const widgets = new FakeWidgets();
    await expect(
      new CreateWidget(new FakeUnitOfWork(widgets), new FixedIds()).execute({ name: "" }),
    ).rejects.toThrow(WidgetNameInvalid);
    expect(await widgets.findById("w-1")).toBeUndefined();
  });
});
