import { Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { shutdownTelemetry } from "./telemetry-state.js";

/** Flushes spans when the app closes, after the HTTP server, so the last requests are exported. */
@Injectable()
class TelemetryFlusher implements OnApplicationShutdown {
  /** Nest lifecycle hook: runs after the HTTP server closed. */
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

/** Ties the SDK started by the instrumentation entry to the app's shutdown. */
@Module({ providers: [TelemetryFlusher] })
export class TelemetryModule {}
