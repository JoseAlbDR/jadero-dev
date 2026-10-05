import { recordInInbox, type SqlExecutor } from "@jadero/messaging";
import { PG_POOL, withTransaction } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import {
  HeartbeatInbox,
  type HeartbeatScope,
  HeartbeatUnitOfWork,
  type InboxEvent,
} from "../application/heartbeat.unit-of-work.js";
import { DrizzleHeartbeatRepository } from "./drizzle-heartbeat.repository.js";

/** The inbox on the transaction's connection: WP-5's raw `recordInInbox`, the explicit executor inside. */
class SqlHeartbeatInbox extends HeartbeatInbox {
  constructor(private readonly executor: SqlExecutor) {
    super();
  }

  /** {@inheritDoc HeartbeatInbox.record} */
  record(queue: string, event: InboxEvent): Promise<boolean> {
    return recordInInbox(this.executor, queue, event);
  }
}

/**
 * The heartbeat's unit of work on Postgres: one pooled connection per `run`, through
 * `withTransaction`, with the inbox (raw SQL) and the repository (Drizzle) built on that one
 * connection (Q2 B, "with A inside the adapters").
 */
@Injectable()
export class DrizzleHeartbeatUnitOfWork extends HeartbeatUnitOfWork {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  /** {@inheritDoc HeartbeatUnitOfWork.run} */
  run<T>(work: (scope: HeartbeatScope) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, ({ db, executor }) =>
      work({
        inbox: new SqlHeartbeatInbox(executor),
        heartbeats: new DrizzleHeartbeatRepository(db),
      }),
    );
  }
}
