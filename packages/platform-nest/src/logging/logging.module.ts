import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { createRequestLogger, type LoggingOptions } from "./logger-params.js";

/**
 * The token of the process's pino-http middleware, which `configureApp` mounts ahead of Helmet
 * and the JSON body parser.
 */
export const REQUEST_LOGGER = Symbol("REQUEST_LOGGER");

/**
 * Structured JSON logging with a request id on every line, through nestjs-pino. Providers inject
 * `PinoLogger` (exported by this package) and log without passing the request around: the id
 * comes from AsyncLocalStorage.
 *
 * The pino-http middleware is built here and mounted by `configureApp`, first in the pipeline,
 * instead of by nestjs-pino at `init()`, after everything `app.use` registered: nestjs-pino runs
 * with `useExisting`, so it only binds the request's logger to AsyncLocalStorage, and its
 * out-of-request logger is a child of the same pino instance (no second transport, same
 * serializers, redaction and hooks).
 */
@Module({})
export class LoggingModule {
  /**
   * @param options the service name, level and output format.
   * @returns the module, which exports the nestjs-pino logger and the {@link REQUEST_LOGGER}
   * middleware.
   */
  static forRoot(options: LoggingOptions): DynamicModule {
    const requestLogger = createRequestLogger(options);
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          // `wrapSerializers: false`: the child keeps the platform's serializers, not pino-http's.
          pinoHttp: { logger: requestLogger.logger, wrapSerializers: false },
          useExisting: true,
        }),
      ],
      providers: [{ provide: REQUEST_LOGGER, useValue: requestLogger }],
      exports: [LoggerModule, REQUEST_LOGGER],
    };
  }
}
