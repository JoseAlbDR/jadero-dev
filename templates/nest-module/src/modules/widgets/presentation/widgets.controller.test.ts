import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateWidget, type CreateWidgetInput } from "../application/create-widget.use-case.js";
import { IdGenerator } from "../application/id-generator.js";
import { WidgetsUnitOfWork } from "../application/widgets.unit-of-work.js";
import { WidgetNameInvalid } from "../domain/widget.errors.js";
import { WidgetsController } from "./widgets.controller.js";

/**
 * A use case stand-in that answers with a fixed result or throws a fixed error, so the controller's
 * only logic, mapping domain errors to HTTP, is tested alone. The use case has its own tests.
 */
class ScriptedCreateWidget extends CreateWidget {
  constructor(private readonly outcome: { id: string; name: string } | Error) {
    super({} as WidgetsUnitOfWork, {} as IdGenerator);
  }

  override async execute(_input: CreateWidgetInput): Promise<{ id: string; name: string }> {
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

describe("WidgetsController (domain errors to HTTP)", () => {
  it("returns what the use case created", async () => {
    const controller = new WidgetsController(new ScriptedCreateWidget({ id: "w-1", name: "lamp" }));
    await expect(controller.create({ name: "lamp" })).resolves.toEqual({ id: "w-1", name: "lamp" });
  });

  it("maps a broken domain rule to 422 with the rule's message", async () => {
    const controller = new WidgetsController(new ScriptedCreateWidget(new WidgetNameInvalid("")));
    const error = await controller.create({ name: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).message).toBe(
      "A widget name must have 1 to 60 characters.",
    );
  });

  it("lets any other error through unchanged, for the problem-details filter to render as 500", async () => {
    const failure = new Error("database down");
    const controller = new WidgetsController(new ScriptedCreateWidget(failure));
    await expect(controller.create({ name: "lamp" })).rejects.toBe(failure);
  });
});
