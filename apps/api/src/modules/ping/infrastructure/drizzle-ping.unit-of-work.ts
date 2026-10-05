import type { EnvelopeOf, EventContract } from "@jadero/contracts";
import { addToOutbox, type SqlExecutor } from "@jadero/messaging";
import { PG_POOL, withTransaction } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import type { z } from "zod";
import { PingOutbox, type PingScope, PingUnitOfWork } from "../application/ping.unit-of-work.js";

/** The CloudEvents source of every event `api` writes. */
const SOURCE = "jadero/api";

/** The outbox on the transaction's connection: WP-5's raw `addToOutbox`, the explicit executor inside. */
class SqlPingOutbox extends PingOutbox {
  constructor(private readonly executor: SqlExecutor) {
    super();
  }

  /** {@inheritDoc PingOutbox.add} */
  add<C extends EventContract<string, z.ZodType>>(
    contract: C,
    data: z.input<C["data"]>,
  ): Promise<EnvelopeOf<C>> {
    return addToOutbox(this.executor, contract, data, SOURCE);
  }
}

/**
 * The ping's unit of work on Postgres: one pooled connection per `run`, through `withTransaction`
 * (Q2 B, "with A inside the adapters": the connection is passed explicitly, no hidden state).
 */
@Injectable()
export class DrizzlePingUnitOfWork extends PingUnitOfWork {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  /** {@inheritDoc PingUnitOfWork.run} */
  run<T>(work: (scope: PingScope) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, ({ executor }) =>
      work({ outbox: new SqlPingOutbox(executor) }),
    );
  }
}
