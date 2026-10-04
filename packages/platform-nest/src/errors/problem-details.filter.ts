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
 * The one exception filter of a service (ADR-006): every error leaves as
 * `application/problem+json` (RFC 9457). Validation failures list each invalid field; other
 * HTTP exceptions keep their status; anything else is a 500 whose message and stack go to the
 * log only (exception shielding). Every body carries the request id from the logging module and,
 * when telemetry is on, the trace id, so one id from a client finds the log lines and the trace.
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
    const problem = this.toProblem(exception, request.originalUrl ?? request.url);
    const requestId = typeof request.id === "string" ? request.id : undefined;
    const traceId = currentTraceId();
    response
      .status(problem.status)
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
