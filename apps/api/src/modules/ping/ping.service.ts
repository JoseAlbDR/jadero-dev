import { systemPingV1 } from "@jadero/contracts";
import { addToOutbox, inTransaction } from "@jadero/messaging";
import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { PG_POOL } from "../platform/index.js";

/**
 * Writes a `system.ping.v1` event to `api`'s outbox (WP-5). It never touches the broker: the relay
 * in `api-worker` publishes it, which is the whole path the ping exists to prove.
 */
@Injectable()
export class PingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * @param trigger `manual` from the dev endpoint, `heartbeat` from `api-worker`'s timer.
   * @returns the event id, the key the consumer's inbox records.
   */
  async send(trigger: "manual" | "heartbeat"): Promise<string> {
    const envelope = await inTransaction(this.pool, (tx) =>
      addToOutbox(tx, systemPingV1, { trigger }, "jadero/api"),
    );
    return envelope.id;
  }
}
