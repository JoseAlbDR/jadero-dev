import { STATUS_CODES } from "node:http";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { currentTraceId } from "../telemetry/trace-id.js";
import { PROBLEM_TYPE_BASE, type ProblemDetails } from "./problem-details.js";
import { RequestValidationException } from "./request-validation.exception.js";

const UNEXPECTED = "An unexpected error occurred.";

/**
 * Express middleware errors that are the client's fault (body-parser's 413 payload too large,
 * 415 unsupported media type, 400 request aborted) are `http-errors` instances, not Nest
 * exceptions: they carry a 4xx `status` and `expose: true` when their message is safe to show.
 */
function asExposedClientError(exception: unknown): { status: number; message: string } | undefined {
  if (typeof exception !== "object" || exception === null) return undefined;
  const { status, expose, message } = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (typeof status !== "number" || status < 400 || status > 499 || expose !== true)
    return undefined;
  return {
    status,
    message: typeof message === "string" ? message : (STATUS_CODES[status] ?? "Error"),
  };
}

/**
 * The one exception filter of a service (ADR-006): every error leaves as
 * `application/problem+json` (RFC 9457). Validation failures list each invalid field; other
 * HTTP exceptions keep their status; anything else is a 500 whose message and stack go to the
 * log only (exception shielding). Every body carries the request id from the logging module and,
 * when telemetry is on, the trace id, so one id from a client finds the log lines and the trace.
 * Every error carries `Cache-Control: no-store` (WP-12 D6).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  /**
   * @param exception whatever a handler, guard, pipe or interceptor threw.
   * @param host the request context; only HTTP is handled.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    // Path only: a query string may carry an email or a token.
    const url = request.originalUrl ?? request.url;
    const path = url.split("?")[0] ?? "/";
    const found = this.toProblem(exception, path);
    // Nest's own 404 message repeats the full URL ("Cannot GET /x?email=..."): keep the path only.
    const problem = url === path ? found : { ...found, detail: found.detail.replaceAll(url, path) };
    const requestId = typeof request.id === "string" ? request.id : undefined;
    const traceId = currentTraceId();
    // An error is never stored by any cache: a cached 404 would hide an item published a moment
    // later, and this also replaces a success header (`public, max-age=60`) set before the throw.
    response
      .status(problem.status)
      .setHeader("Cache-Control", "no-store")
      .type("application/problem+json")
      .json({ ...problem, ...(requestId && { requestId }), ...(traceId && { traceId }) });
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof RequestValidationException) {
      const count = exception.fields.length;
      return {
        type: `${PROBLEM_TYPE_BASE}validation-failed`,
        title: "Request validation failed",
        status: 400,
        detail: count === 1 ? "1 field is invalid." : `${count} fields are invalid.`,
        instance,
        errors: exception.fields,
      };
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      return {
        type: "about:blank",
        title: STATUS_CODES[status] ?? "Error",
        status,
        detail: exception.message,
        instance,
      };
    }
    const clientError = asExposedClientError(exception);
    if (clientError) {
      const { status, message } = clientError;
      return {
        type: "about:blank",
        title: STATUS_CODES[status] ?? "Error",
        status,
        detail: message,
        instance,
      };
    }
    this.logger.error(
      exception instanceof Error ? exception : { err: exception },
      "unhandled exception",
    );
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    return {
      type: "about:blank",
      title: STATUS_CODES[status] ?? "Error",
      status,
      detail: UNEXPECTED,
      instance,
    };
  }
}
