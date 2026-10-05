import { Injectable } from "@nestjs/common";
import { Widget } from "../domain/widget.js";
import { IdGenerator } from "./id-generator.js";
import { WidgetsUnitOfWork } from "./widgets.unit-of-work.js";

/** Input of {@link CreateWidget}; the controller builds it from the validated body. */
export interface CreateWidgetInput {
  readonly name: string;
}

/**
 * One use case per class: orchestrates the domain and the ports, holds no rules of its own.
 * Depends on ports only, never on infrastructure (rule application-never-imports-infrastructure).
 * It owns the transaction (ADR-012): the write runs inside the unit of work. A use case that only
 * displays widgets would inject `WidgetRepository` and read outside `run` (WP-10 Decision).
 */
@Injectable()
export class CreateWidget {
  constructor(
    private readonly uow: WidgetsUnitOfWork,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Creates and stores a widget in one transaction.
   * @returns the new widget's id and name.
   * @throws {WidgetNameInvalid} from the domain when the name breaks the rule; nothing is stored.
   */
  async execute(input: CreateWidgetInput): Promise<{ id: string; name: string }> {
    const widget = Widget.create(this.ids.next(), input.name);
    // A second write goes in the same run, so both commit or neither does: in a module with an
    // event, the outbox row (addToOutbox on the transaction's connection) joins the scope here.
    await this.uow.run(async ({ widgets }) => widgets.save(widget));
    return { id: widget.id, name: widget.name };
  }
}
