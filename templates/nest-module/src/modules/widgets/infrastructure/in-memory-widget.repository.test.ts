import { widgetRepositoryContract } from "../application/widget.repository.contract.js";
import { InMemoryWidgetRepository } from "./in-memory-widget.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int` (WP-10 step 7).
widgetRepositoryContract("in-memory", () => new InMemoryWidgetRepository());
