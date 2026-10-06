import { drizzleOn } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { widgetRepositoryContract } from "../src/modules/widgets/application/widget.repository.contract.js";
import { widgetsUnitOfWorkContract } from "../src/modules/widgets/application/widgets.unit-of-work.contract.js";
import { DrizzleWidgetRepository } from "../src/modules/widgets/infrastructure/drizzle-widget.repository.js";
import { DrizzleWidgetsUnitOfWork } from "../src/modules/widgets/infrastructure/drizzle-widgets.unit-of-work.js";
import { createTestDatabase } from "./setup/test-database.js";
import { widgetsDdl } from "./support/widgets-ddl.js";

// WP-10 D7 suite 2: the same contract suites the in-memory fakes pass in `pnpm verify`, here on the
// Drizzle adapters and real Postgres. The unit of work suite's "work throws" case is the domain-row
// rollback: the widget saved inside `run` is gone after the throw, and the same error reaches the
// caller. Every test uses a new UUID, so the tests share the table without seeing each other.
let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createTestDatabase();
  drop = database.drop;
  pool = new pg.Pool({ connectionString: database.url, max: 4 });
  // Created by the database's ordinary owner role, from the schema file (no hand-written DDL).
  for (const statement of await widgetsDdl()) await pool.query(statement);
});

afterAll(async () => {
  await pool.end();
  await drop();
});

widgetRepositoryContract("Drizzle on Postgres", () => new DrizzleWidgetRepository(drizzleOn(pool)));

widgetsUnitOfWorkContract("Drizzle on Postgres", () => ({
  unitOfWork: new DrizzleWidgetsUnitOfWork(pool),
  // Outside any transaction: it sees only what `run` committed.
  widgets: new DrizzleWidgetRepository(drizzleOn(pool)),
}));
