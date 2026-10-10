import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";

/**
 * Keeps Terminus' own body on a failed health check (WP-3 decision E1): Docker, Uptime Kuma and
 * people read `{"status":"error","error":{...}}`, not problem+json. Bound to the health controller,
 * so it wins over the global problem-details filter only there. Never cached, like every error.
 */
@Catch(ServiceUnavailableException)
export class HealthBodyFilter implements ExceptionFilter {
  /**
   * @param exception the 503 Terminus throws, carrying the health body.
   * @param host the request context.
   */
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(503)
      .setHeader("Cache-Control", "no-store")
      .json(exception.getResponse());
  }
}
