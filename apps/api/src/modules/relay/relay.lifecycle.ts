import { MessageBus, OutboxRelay } from "@jadero/messaging";
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ApiWorkerConfig } from "../../config/api-config.js";
import { PingService } from "../ping/index.js";

/** How often published outbox rows past their retention are deleted. */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `api-worker`'s background work: the outbox relay (ADR-012), the heartbeat ping every
 * `HEARTBEAT_INTERVAL_MS` (WP-5 decision W1 c) and the daily outbox cleanup (published rows older
 * than 7 days). On shutdown it stops all three before the pool closes, then closes the broker
 * connection.
 */
@Injectable()
export class RelayLifecycle
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private heartbeat: NodeJS.Timeout | undefined;
  private cleanup: NodeJS.Timeout | undefined;

  constructor(
    private readonly relay: OutboxRelay,
    private readonly bus: MessageBus,
    private readonly ping: PingService,
    @Inject(ApiWorkerConfig) private readonly config: ApiWorkerConfig,
  ) {}

  /** Nest lifecycle hook: starts the relay and the heartbeat. */
  onApplicationBootstrap(): void {
    this.relay.start();
    const beat = () => void this.ping.send("heartbeat").catch(() => undefined);
    beat();
    this.heartbeat = setInterval(beat, this.config.heartbeatIntervalMs);
    const clean = () => void this.relay.cleanup().catch(() => undefined);
    clean();
    this.cleanup = setInterval(clean, CLEANUP_INTERVAL_MS);
  }

  /** Nest lifecycle hook: stops the timers and waits for the relay's batch in progress. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.cleanup) clearInterval(this.cleanup);
    await this.relay.stop();
  }

  /** Nest lifecycle hook: closes the broker connection last. */
  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
