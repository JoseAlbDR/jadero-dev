import { systemPingV1 } from "@jadero/contracts";
import { Injectable } from "@nestjs/common";
import { PingUnitOfWork } from "./application/ping.unit-of-work.js";

/**
 * Writes a `system.ping.v1` event to `api`'s outbox (WP-5). It never touches the broker: the relay
 * in `api-worker` publishes it, which is the whole path the ping exists to prove. The transaction
 * boundary is the unit of work (WP-10 Q2 B); the service knows no pool and no SQL.
 */
@Injectable()
export class PingService {
  constructor(private readonly uow: PingUnitOfWork) {}

  /**
   * @param trigger `manual` from the dev endpoint, `heartbeat` from `api-worker`'s timer.
   * @returns the event id, the key the consumer's inbox records.
   */
  async send(trigger: "manual" | "heartbeat"): Promise<string> {
    const envelope = await this.uow.run(({ outbox }) => outbox.add(systemPingV1, { trigger }));
    return envelope.id;
  }
}
