import { Module } from "@nestjs/common";
import { PingController } from "./ping.controller.js";
import { PingService } from "./ping.service.js";

/** The ping service, for `api-worker`'s heartbeat; the pool comes from the global `DatabaseModule`. */
@Module({ providers: [PingService], exports: [PingService] })
export class PingModule {}

/** The ping service plus `POST /dev/ping`; `AppModule` imports it in development only. */
@Module({ imports: [PingModule], controllers: [PingController] })
export class DevPingModule {}
