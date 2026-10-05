import { systemPingV1 } from "@jadero/contracts";
import { addToOutbox } from "@jadero/messaging";
import { PG_POOL, withTransaction } from "@jadero/platform-nest";
import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";

/**
 * Writes a `system.ping.v1` event to `api`'s outbox (WP-5). It never touches the broker: the relay
 * in `api-worker` publishes it, which is the whole path the ping exists to prove. A layered module
 * with no rules (ADR-003, WP-10 D5): it opens the transaction with platform-nest's
 * `withTransaction` directly, no unit of work port.
 */
@Injectable()
export class PingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Adds one ping to the outbox in its own transaction (ADR-012).
   * @param trigger `manual` from the dev endpoint, `heartbeat` from `api-worker`'s timer.
   * @returns the event id, the key the consumer's inbox records.
   */
  async send(trigger: "manual" | "heartbeat"): Promise<string> {
    const envelope = await withTransaction(this.pool, ({ executor }) =>
      addToOutbox(executor, systemPingV1, { trigger }, "jadero/api"),
    );
    return envelope.id;
  }
}
