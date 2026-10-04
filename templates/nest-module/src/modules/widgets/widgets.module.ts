import { Module } from "@nestjs/common";
import { CreateWidget } from "./application/create-widget.use-case.js";
import { IdGenerator } from "./application/id-generator.js";
import { WidgetRepository } from "./application/widget.repository.js";
import { InMemoryWidgetRepository } from "./infrastructure/in-memory-widget.repository.js";
import { RandomIdGenerator } from "./infrastructure/random-id-generator.js";
import { WidgetsController } from "./presentation/widgets.controller.js";

/**
 * Hexagonal module (ADR-003). The wiring is the only place that knows which adapter backs each
 * port: swap `InMemoryWidgetRepository` for a Drizzle one here and nothing else changes.
 */
@Module({
  controllers: [WidgetsController],
  providers: [
    CreateWidget,
    { provide: WidgetRepository, useClass: InMemoryWidgetRepository },
    { provide: IdGenerator, useClass: RandomIdGenerator },
  ],
})
export class WidgetsModule {}
