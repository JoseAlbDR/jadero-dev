import { MessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { PinoLogger } from "@jadero/platform-nest";
import { Logger, Module } from "@nestjs/common";
import { AgentConsumerConfig } from "../../config/agent-config.js";
import { HeartbeatUnitOfWork } from "./application/heartbeat.unit-of-work.js";
import { HeartbeatConsumer } from "./heartbeat.consumer.js";
import { DrizzleHeartbeatUnitOfWork } from "./infrastructure/drizzle-heartbeat.unit-of-work.js";

/**
 * The consumer process's messaging: the RabbitMQ bus as `MessageBus`, and the ping consumer with
 * its unit of work port bound to the Postgres adapter.
 */
@Module({
  providers: [
    {
      provide: MessageBus,
      useFactory: (config: AgentConsumerConfig, log: PinoLogger) => {
        log.setContext("MessageBus");
        // Prefetch 4: each delivery holds one pooled connection for its inbox transaction, and the
        // pool (DATABASE_POOL_MAX, default 6) keeps two more for the readiness check and the inbox cleanup.
        return new RabbitMqMessageBus({
          uri: config.rabbitmqUrl,
          prefetch: 4,
          logger: new Logger("RabbitMQ"),
          log,
        });
      },
      inject: [AgentConsumerConfig, PinoLogger],
    },
    { provide: HeartbeatUnitOfWork, useClass: DrizzleHeartbeatUnitOfWork },
    HeartbeatConsumer,
  ],
  exports: [MessageBus],
})
export class HeartbeatModule {}
