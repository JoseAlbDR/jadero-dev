import { type BeforeApplicationShutdown, Injectable } from "@nestjs/common";

/**
 * Flips to "shutting down" when SIGTERM starts `app.close()`, before the HTTP server closes, so
 * `/health/ready` answers 503 while in-flight requests finish (graceful shutdown).
 */
@Injectable()
export class ShutdownState implements BeforeApplicationShutdown {
  private shuttingDown = false;

  /** True once shutdown has started. */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Nest lifecycle hook: runs after `onModuleDestroy`, before the server closes. */
  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
