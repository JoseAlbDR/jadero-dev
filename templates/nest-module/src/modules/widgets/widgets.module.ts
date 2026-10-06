import { Module } from "@nestjs/common";
import { CreateWidget } from "./application/create-widget.use-case.js";
import { IdGenerator } from "./application/id-generator.js";
import { WidgetRepository } from "./application/widget.repository.js";
import { WidgetsUnitOfWork } from "./application/widgets.unit-of-work.js";
import { InMemoryWidgetRepository } from "./infrastructure/in-memory-widget.repository.js";
import { InMemoryWidgetsUnitOfWork } from "./infrastructure/in-memory-widgets.unit-of-work.js";
import { UuidV7IdGenerator } from "./infrastructure/uuid-v7-id-generator.js";
import { WidgetsController } from "./presentation/widgets.controller.js";

/**
 * Hexagonal module (ADR-003). The wiring is the only place that knows which adapter backs each
 * port. The template binds the in-memory adapters, so it boots without a database; a service binds
 * `DrizzleWidgetRepository` and `DrizzleWidgetsUnitOfWork` instead (README, "Bind the Drizzle
 * adapters") and nothing else changes. Both in-memory ports share one store, so a read outside
 * `run` sees what `run` committed, as with one database.
 */
@Module({
  controllers: [WidgetsController],
  providers: [
    CreateWidget,
    InMemoryWidgetRepository,
    { provide: WidgetRepository, useExisting: InMemoryWidgetRepository },
    { provide: WidgetsUnitOfWork, useClass: InMemoryWidgetsUnitOfWork },
    { provide: IdGenerator, useClass: UuidV7IdGenerator },
  ],
})
export class WidgetsModule {}
