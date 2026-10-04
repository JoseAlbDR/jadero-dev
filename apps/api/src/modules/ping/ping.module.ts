import { Module } from "@nestjs/common";
import { PostgresModule } from "../platform/index.js";
import { PingController } from "./ping.controller.js";
import { PingService } from "./ping.service.js";

/** The ping service, for `api-worker`'s heartbeat. */
@Module({ imports: [PostgresModule], providers: [PingService], exports: [PingService] })
export class PingModule {}

/** The ping service plus `POST /dev/ping`; `AppModule` imports it in development only. */
@Module({ imports: [PingModule], controllers: [PingController] })
export class DevPingModule {}
