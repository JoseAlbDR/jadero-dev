import { STATUS_CODES } from "node:http";
import type { NextFunction, Request, Response } from "express";

/**
 * The fixed `detail` of each client error the JSON body parser (body-parser and raw-body) raises,
 * by the error's `type`. Their own messages can reflect the client's input: JSON.parse quotes a
 * fragment of the body (and its wording changes between Node versions), and the charset and
 * content encoding errors repeat a request header. An error response never reflects client input
 * (WP-12 step 8d, owner decision A of 2026-10-10). The 413 and the other fixed library messages
 * keep their text.
 */
const BODY_ERROR_DETAILS: Readonly<Record<string, string>> = {
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.verify.failed": "The request body was rejected.",
  "charset.unsupported": "The request body's charset is not supported.",
  "encoding.unsupported": "The request body's content encoding is not supported.",
  "entity.too.large": "request entity too large",
  "request.aborted": "request aborted",
  "request.size.invalid": "request size did not match content length",
};

/**
 * The detail a client sees for an Express middleware client error: the fixed text of its `type`,
 * else the status's reason phrase. Never the error's own message.
 * @param status the 4xx status of the error.
 * @param type the `http-errors` type (`entity.parse.failed`), if any.
 * @returns the detail for the problem body.
 */
export function requestBodyErrorDetail(status: number, type: unknown): string {
  if (typeof type === "string" && Object.hasOwn(BODY_ERROR_DETAILS, type)) {
    return BODY_ERROR_DETAILS[type] as string;
  }
  return STATUS_CODES[status] ?? "Error";
}

/** An `http-errors` client error: a 4xx `status`, `expose: true` and, from body-parser, a `type`. */
export interface ExposedClientError {
  readonly status: number;
  readonly type?: unknown;
}

/**
 * Whether a value is an `http-errors` client error, the shape Express middleware (body-parser's
 * 400, 413 and 415) raises instead of a Nest exception.
 * @param value whatever was thrown or passed to `next`.
 * @returns true for a 4xx error marked safe to expose.
 */
export function isExposedClientError(value: unknown): value is ExposedClientError {
  if (typeof value !== "object" || value === null) return false;
  const { status, expose } = value as { status?: unknown; expose?: unknown };
  return typeof status === "number" && status >= 400 && status <= 499 && expose === true;
}

/**
 * A body parser client error reduced to its status and type, with its fixed detail as message.
 * The original carries the client's input twice: in its message and, for a parse failure, the raw
 * body in its `body` property; neither travels further.
 */
export class RequestBodyError extends Error {
  /** Read by the filter like any `http-errors` error: the status and detail are safe to show. */
  readonly expose = true;

  /**
   * @param status the 4xx status body-parser chose.
   * @param type body-parser's error type (`entity.parse.failed`), if any.
   */
  constructor(
    readonly status: number,
    readonly type: unknown,
  ) {
    super(requestBodyErrorDetail(status, type));
    this.name = "RequestBodyError";
  }
}

/**
 * Express error middleware mounted right after the JSON body parser. body-parser raises malformed
 * JSON as a `SyntaxError`, and Nest's Express adapter (`mapException`) turns every `SyntaxError`
 * into `new BadRequestException(error.message)` before any filter runs, so the filter would see
 * JSON.parse's message and no `type`. This hands every body parser client error on as a
 * {@link RequestBodyError}, which Nest leaves alone; other errors pass through unchanged.
 * Express knows an error middleware by its four parameters.
 * @param error what the body parser passed to `next`.
 * @param _req the request (unused).
 * @param _res the response (unused).
 * @param next the next error handler.
 */
export function shieldRequestBodyErrors(
  error: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(isExposedClientError(error) ? new RequestBodyError(error.status, error.type) : error);
}
