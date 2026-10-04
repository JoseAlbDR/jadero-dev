import { type BeforeApplicationShutdown, Inject, Injectable, Optional } from "@nestjs/common";

/** Token for the drain time in milliseconds (`HealthModule.forRoot({ drainMs })`). */
export const SHUTDOWN_DRAIN_MS = Symbol("SHUTDOWN_DRAIN_MS");

/**
 * Flips to "shutting down" when SIGTERM starts `app.close()`, before the HTTP server closes. Nest
 * closes the server right after this hook, so with no drain time the flag only covers requests
 * already in flight. Behind a load balancer that polls readiness, set `drainMs` to a few probe
 * intervals: the hook then waits, readiness answers 503, and the balancer stops sending traffic
 * before the listener closes (graceful shutdown).
 */
@Injectable()
export class ShutdownState implements BeforeApplicationShutdown {
  private shuttingDown = false;

  constructor(@Optional() @Inject(SHUTDOWN_DRAIN_MS) private readonly drainMs = 0) {}

  /** True once shutdown has started. */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Nest lifecycle hook: runs after `onModuleDestroy`, before the server closes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.drainMs > 0) await new Promise((resolve) => setTimeout(resolve, this.drainMs));
  }
}
