import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Params } from "nestjs-pino";
import type { DestinationStream, Level } from "pino";

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
 * The level of the one line pino-http writes per request: errors at `error`, client errors at
 * `warn`, health probes at `debug` (they run every few seconds), everything else at `info`.
 * @param req the request.
 * @param res the finished response.
 * @param error the error pino-http saw, if any.
 * @returns the pino level for the request line.
 */
export function requestLogLevel(req: IncomingMessage, res: ServerResponse, error?: Error): Level {
  if (error || res.statusCode >= 500) return "error";
  if (res.statusCode >= 400) return "warn";
  if (req.url?.startsWith("/health/")) return "debug";
  return "info";
}

/**
 * Builds the nestjs-pino configuration. Request lines carry method, URL, status and `req_id`;
 * headers, bodies and the client IP are never logged (AGENTS.md section 7), and the auth headers
 * are redacted in case a custom log line includes them.
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
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
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
