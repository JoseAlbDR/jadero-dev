import { widgetsUnitOfWorkContract } from "../application/widgets.unit-of-work.contract.js";
import { InMemoryWidgetRepository } from "./in-memory-widget.repository.js";
import { InMemoryWidgetsUnitOfWork } from "./in-memory-widgets.unit-of-work.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int` (WP-10 step 7).
widgetsUnitOfWorkContract("in-memory", () => {
  const widgets = new InMemoryWidgetRepository();
  return { unitOfWork: new InMemoryWidgetsUnitOfWork(widgets), widgets };
});
