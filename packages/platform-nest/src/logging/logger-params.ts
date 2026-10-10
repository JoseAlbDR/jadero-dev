import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Params } from "nestjs-pino";
import type { DestinationStream, Level, LogFn } from "pino";
import { redactQueryErrors, serializeError } from "./error-serializer.js";

/** What a service tells the logging module about itself. */
export interface LoggingOptions {
  /** Written as `service` on every line (ADR-010). */
  readonly serviceName: string;
  readonly level: Level;
  /** Human-readable lines through pino-pretty; development only. */
  readonly pretty: boolean;
  /** Where lines go instead of stdout; tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

/** An incoming `x-request-id` is reused only when it matches; anything else gets a new UUID. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * Picks the request id: the caller's `x-request-id` when it is safe to log, else a new UUID.
 * Echoes it in the response header so a client can quote it.
 * @param req the incoming request.
 * @param res the response, which gets the `x-request-id` header.
 * @returns the id pino-http stores as `req.id`.
 */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", id);
  return id;
}

/**
 * The level of the one line pino-http writes per request. Health probes run every few seconds:
 * `debug` when they pass, `warn` on the expected 503 (the failing check logs its own cause);
 * any other failure on a health route follows the general rule. Other requests: errors at `error`, client errors at `warn`, everything else at `info`.
 * @param req the request.
 * @param res the finished response.
 * @param error the error pino-http saw, if any.
 * @returns the pino level for the request line.
 */
export function requestLogLevel(req: IncomingMessage, res: ServerResponse, error?: Error): Level {
  if (
    req.url?.startsWith("/health/") &&
    !error &&
    (res.statusCode < 400 || res.statusCode === 503)
  ) {
    return res.statusCode === 503 ? "warn" : "debug";
  }
  if (error || res.statusCode >= 500) return "error";
  if (res.statusCode >= 400) return "warn";
  return "info";
}

/**
 * Swaps a database error passed to a log call (`logger.error(err)` or `logger.error({ err })`) for
 * its redacted copy before pino sees it: with no message argument, pino writes the error's own
 * message as `msg`, and Drizzle's carries the bound parameters.
 * @param args the arguments of the log call.
 * @returns the arguments to log, the same array when nothing changed.
 */
export function redactLogArguments(args: Parameters<LogFn>): Parameters<LogFn> {
  const [first, ...rest] = args as unknown[];
  if (first instanceof Error) {
    const safe = redactQueryErrors(first);
    return safe === first ? args : ([safe, ...rest] as Parameters<LogFn>);
  }
  const err = (first as { err?: unknown } | null)?.err;
  if (typeof first !== "object" || !(err instanceof Error)) return args;
  const safe = redactQueryErrors(err);
  return safe === err ? args : ([{ ...first, err: safe }, ...rest] as Parameters<LogFn>);
}

/**
 * Builds the nestjs-pino configuration. Request lines carry method, URL, status and `req_id`;
 * headers, bodies and the client IP are never logged (AGENTS.md section 7), and the auth headers
 * are redacted in case a custom log line includes them. A logged database error keeps its code,
 * constraint, table and SQL text, never its bound parameters nor Postgres's `detail`.
 * @param options the service's logging options.
 * @returns the parameters for `LoggerModule.forRoot`.
 */
export function loggerParams(options: LoggingOptions): Params {
  const pinoOptions = {
    level: options.level,
    base: { service: options.serviceName },
    genReqId: requestId,
    customLogLevel: requestLogLevel,
    customProps: (req: IncomingMessage) => ({ req_id: (req as RequestWithId).id }),
    serializers: {
      // Path only: a query string may carry an email or a token.
      req: (req: { method: string; url: string }) => ({
        method: req.method,
        url: req.url.split("?")[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    hooks: {
      logMethod(this: unknown, args: Parameters<LogFn>, method: LogFn): void {
        method.apply(this, redactLogArguments(args));
      },
    },
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    ...(options.pretty && !options.destination
      ? {
          transport: {
            target: fileURLToPath(import.meta.resolve("pino-pretty")),
            options: { singleLine: true },
          },
        }
      : {}),
  };
  return { pinoHttp: options.destination ? [pinoOptions, options.destination] : pinoOptions };
}
