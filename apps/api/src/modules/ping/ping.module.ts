import { Module } from "@nestjs/common";
import { PingUnitOfWork } from "./application/ping.unit-of-work.js";
import { DrizzlePingUnitOfWork } from "./infrastructure/drizzle-ping.unit-of-work.js";
import { PingController } from "./ping.controller.js";
import { PingService } from "./ping.service.js";

/**
 * The ping service, for `api-worker`'s heartbeat. The wiring binds the unit of work port to its
 * Postgres adapter; the pool comes from the global `DatabaseModule`.
 */
@Module({
  providers: [PingService, { provide: PingUnitOfWork, useClass: DrizzlePingUnitOfWork }],
  exports: [PingService],
})
export class PingModule {}

/** The ping service plus `POST /dev/ping`; `AppModule` imports it in development only. */
@Module({ imports: [PingModule], controllers: [PingController] })
export class DevPingModule {}
