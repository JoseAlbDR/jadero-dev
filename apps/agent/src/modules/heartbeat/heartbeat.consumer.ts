import { systemPingV1 } from "@jadero/contracts";
import { cleanupInbox, idempotent, MessageBus } from "@jadero/messaging";
import { PG_POOL, PinoLogger } from "@jadero/platform-nest";
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { Pool } from "pg";
import { HeartbeatRepository } from "./heartbeat.repository.js";

/** How often inbox rows past their retention (30 days, decision I1) are deleted. */
export const INBOX_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The queue this consumer reads; it exists in `infra/rabbitmq/definitions.json` (a test checks). */
export const HEARTBEAT_QUEUE = "agent.system.ping";

/**
 * Consumes `system.ping.v1` on `agent.system.ping` (WP-5): the inbox insert and the heartbeat
 * upsert run in one transaction, so a duplicate delivery changes nothing (idempotent consumer,
 * ADR-012). Subscribes on init, starts consuming once the app is up and cleans the inbox daily,
 * stops before the pool closes.
 */
@Injectable()
export class HeartbeatConsumer
  implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private cleanup: NodeJS.Timeout | undefined;

  constructor(
    private readonly bus: MessageBus,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly heartbeats: HeartbeatRepository,
    private readonly log: PinoLogger,
  ) {
    log.setContext("HeartbeatConsumer");
  }

  /** Nest lifecycle hook: registers the subscription. */
  onModuleInit(): void {
    this.bus.subscribe({
      queue: HEARTBEAT_QUEUE,
      contract: systemPingV1,
      handle: idempotent<typeof systemPingV1>(
        this.pool,
        (tx, { envelope }) =>
          this.heartbeats.record(tx, {
            source: envelope.source,
            eventId: envelope.id,
            trigger: envelope.data.trigger,
            seenAt: envelope.time,
          }),
        ({ envelope, queue }) =>
          this.log.debug({ event_id: envelope.id, queue }, "duplicate ignored"),
      ),
    });
  }

  /** Nest lifecycle hook: starts consuming (never waits for the broker) and the daily inbox cleanup. */
  async onApplicationBootstrap(): Promise<void> {
    await this.bus.start();
    const clean = () => void cleanupInbox(this.pool).catch(() => undefined);
    clean();
    this.cleanup = setInterval(clean, INBOX_CLEANUP_INTERVAL_MS);
  }

  /** Nest lifecycle hook: stops consuming and lets deliveries in progress finish. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.cleanup) clearInterval(this.cleanup);
    await this.bus.stop();
  }

  /** Nest lifecycle hook: closes the broker connection. */
  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
