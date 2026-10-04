import { Body, Controller, Post, UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";
import { CreateWidget } from "../application/create-widget.use-case.js";
import { WidgetNameInvalid } from "../domain/widget.errors.js";

// In a service this schema lives in packages/contracts (ADR-006).
const CreateWidgetBody = z.object({ name: z.string() });

/**
 * HTTP edge of the hexagonal module: validates the shape (the global pipe answers 400), calls one
 * use case, maps domain errors to HTTP (here 422, which the problem-details filter renders).
 */
@Controller("widgets")
export class WidgetsController {
  constructor(private readonly createWidget: CreateWidget) {}

  /** `POST /widgets` with `{ "name": "..." }`. */
  @Post()
  async create(@Body({ schema: CreateWidgetBody }) body: z.infer<typeof CreateWidgetBody>) {
    try {
      return await this.createWidget.execute(body);
    } catch (error) {
      if (error instanceof WidgetNameInvalid) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
