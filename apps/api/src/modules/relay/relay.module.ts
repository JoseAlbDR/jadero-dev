import { MessageBus, OutboxRelay, RabbitMqMessageBus } from "@jadero/messaging";
import { PinoLogger } from "@jadero/platform-nest";
import { Logger, Module } from "@nestjs/common";
import { Pool } from "pg";
import { ApiWorkerConfig } from "../../config/api-config.js";
import { PingModule } from "../ping/index.js";
import { PG_POOL, PostgresModule } from "../platform/index.js";
import { RelayLifecycle } from "./relay.lifecycle.js";

/**
 * `api-worker`'s messaging: the RabbitMQ bus as the `MessageBus` port, the outbox relay over
 * `api`'s pool, the heartbeat, and the broker readiness check.
 */
@Module({
  imports: [PostgresModule, PingModule],
  providers: [
    {
      provide: MessageBus,
      useFactory: (config: ApiWorkerConfig, log: PinoLogger) => {
        log.setContext("MessageBus");
        return new RabbitMqMessageBus({
          uri: config.rabbitmqUrl,
          logger: new Logger("RabbitMQ"),
          log,
        });
      },
      inject: [ApiWorkerConfig, PinoLogger],
    },
    {
      provide: OutboxRelay,
      useFactory: (pool: Pool, bus: MessageBus, log: PinoLogger) => {
        log.setContext("OutboxRelay");
        return new OutboxRelay({ pool, bus, log });
      },
      inject: [PG_POOL, MessageBus, PinoLogger],
    },
    RelayLifecycle,
  ],
  exports: [MessageBus],
})
export class RelayModule {}
