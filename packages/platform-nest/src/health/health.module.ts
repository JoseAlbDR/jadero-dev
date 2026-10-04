import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController, READINESS_CHECKS } from "./health.controller.js";
import type { ReadinessCheck } from "./readiness-check.js";
import { SHUTDOWN_DRAIN_MS, ShutdownState } from "./shutdown-state.js";

/** What a service registers: its checks, and the modules that provide what they inject. */
export interface HealthModuleOptions {
  readonly checks: readonly Type<ReadinessCheck>[];
  readonly imports?: ModuleMetadata["imports"];
  /** Milliseconds readiness answers 503 before the server closes on shutdown; default 0. */
  readonly drainMs?: number;
}

/**
 * `/health/live` and `/health/ready` through Terminus (ADR-010, WP-3 decision C): the endpoints
 * and status codes are the same in every service; each service brings its own checks.
 */
@Module({})
export class HealthModule {
  /**
   * @param options the service's readiness checks and the modules they need.
   * @returns the module with the health controller and the collected checks.
   */
  static forRoot(options: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule.forRoot({ logger: false }), ...(options.imports ?? [])],
      controllers: [HealthController],
      providers: [
        ShutdownState,
        { provide: SHUTDOWN_DRAIN_MS, useValue: options.drainMs ?? 0 },
        ...options.checks,
        {
          provide: READINESS_CHECKS,
          useFactory: (...checks: ReadinessCheck[]) => checks,
          inject: [...options.checks],
        },
      ],
    };
  }
}
