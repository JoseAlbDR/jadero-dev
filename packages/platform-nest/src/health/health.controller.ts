import { Controller, Get, Inject, Logger, UseFilters } from "@nestjs/common";
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  type HealthIndicatorResult,
  HealthIndicatorService,
} from "@nestjs/terminus";
import { HealthBodyFilter } from "./health-body.filter.js";
import { ReadinessCheck } from "./readiness-check.js";
import { ShutdownState } from "./shutdown-state.js";

/** The token under which `HealthModule` collects the service's readiness checks. */
export const READINESS_CHECKS = Symbol("READINESS_CHECKS");

/** A check that has not answered within this time counts as down, so a probe never hangs. */
export const CHECK_TIMEOUT_MS = 1000;

/** `GET /health/live` and `GET /health/ready`, identical in every service. */
@Controller("health")
@UseFilters(HealthBodyFilter)
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly shutdown: ShutdownState,
    @Inject(READINESS_CHECKS) private readonly checks: ReadinessCheck[],
  ) {}

  /** Liveness: the process answers. Never checks a dependency, so a database blip restarts nothing. */
  @Get("live")
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Readiness: not shutting down, and every dependency answers within the timeout. */
  @Get("ready")
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        const indicator = this.indicators.check("shutdown");
        return this.shutdown.isShuttingDown ? indicator.down() : indicator.up();
      },
      ...this.checks.map((check) => () => this.run(check)),
    ]);
  }

  private async run(check: ReadinessCheck): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check(check.name);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)),
        CHECK_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([check.check(), timeout]);
      return indicator.up();
    } catch (error) {
      // The cause goes to the log; the body says only that the check failed (it may be public).
      this.logger.warn({ err: error, check: check.name }, "readiness check failed");
      return indicator.down({ message: "unavailable" });
    } finally {
      clearTimeout(timer);
    }
  }
}
