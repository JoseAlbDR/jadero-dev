import { type ConnectionSource, PG_POOL, withTransaction } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { type WidgetsScope, WidgetsUnitOfWork } from "../application/widgets.unit-of-work.js";
import { DrizzleWidgetRepository } from "./drizzle-widget.repository.js";
import * as schema from "./widget.schema.js";

/**
 * The real unit of work (WP-10 Q2 B, with A inside the adapter): platform-nest's `withTransaction`
 * checks out one connection, sends `BEGIN`, and this class builds the scope's repositories on that
 * connection's Drizzle, so every write in `work` shares the transaction. `withTransaction` sends
 * `COMMIT` or `ROLLBACK`; nothing here sends `BEGIN` by hand. A second write (the outbox row of an
 * event) would take `withTransaction`'s `executor` into the scope: same connection, same commit.
 */
@Injectable()
export class DrizzleWidgetsUnitOfWork extends WidgetsUnitOfWork {
  constructor(@Inject(PG_POOL) private readonly pool: ConnectionSource) {
    super();
  }

  /**
   * Runs `work` in one Postgres transaction with transaction-bound repositories.
   * @param work the use case's writes.
   * @returns what `work` returned, after `COMMIT`.
   */
  run<T>(work: (scope: WidgetsScope) => Promise<T>): Promise<T> {
    return withTransaction(
      this.pool,
      ({ db }) => work({ widgets: new DrizzleWidgetRepository(db) }),
      { schema },
    );
  }
}
