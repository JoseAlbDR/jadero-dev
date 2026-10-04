import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { type LoggingOptions, loggerParams } from "./logger-params.js";

/**
 * Structured JSON logging with a request id on every line, through nestjs-pino. Providers inject
 * `PinoLogger` (exported by this package) and log without passing the request around: the id
 * comes from AsyncLocalStorage.
 */
@Module({})
export class LoggingModule {
  /**
   * @param options the service name, level and output format.
   * @returns the module, which exports the nestjs-pino logger.
   */
  static forRoot(options: LoggingOptions): DynamicModule {
    return {
      module: LoggingModule,
      imports: [LoggerModule.forRoot(loggerParams(options))],
      exports: [LoggerModule],
    };
  }
}
