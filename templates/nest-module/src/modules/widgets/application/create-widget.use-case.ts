import { Injectable } from "@nestjs/common";
import { Widget } from "../domain/widget.js";
import { IdGenerator } from "./id-generator.js";
import { WidgetRepository } from "./widget.repository.js";

/** Input of {@link CreateWidget}; the controller builds it from the validated body. */
export interface CreateWidgetInput {
  readonly name: string;
}

/**
 * One use case per class: orchestrates the domain and the ports, holds no rules of its own.
 * Depends on ports only, never on infrastructure (rule application-never-imports-infrastructure).
 */
@Injectable()
export class CreateWidget {
  constructor(
    private readonly widgets: WidgetRepository,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Creates and stores a widget.
   * @returns the new widget's id and name.
   * @throws {WidgetNameInvalid} from the domain when the name breaks the rule.
   */
  async execute(input: CreateWidgetInput): Promise<{ id: string; name: string }> {
    const widget = Widget.create(this.ids.next(), input.name);
    await this.widgets.save(widget);
    return { id: widget.id, name: widget.name };
  }
}
