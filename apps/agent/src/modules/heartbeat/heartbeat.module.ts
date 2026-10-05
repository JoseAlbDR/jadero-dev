import { MessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { PinoLogger } from "@jadero/platform-nest";
import { Logger, Module } from "@nestjs/common";
import { AgentConsumerConfig } from "../../config/agent-config.js";
import { HeartbeatConsumer } from "./heartbeat.consumer.js";
import { HeartbeatRepository } from "./heartbeat.repository.js";

/**
 * The consumer process's messaging: the RabbitMQ bus as `MessageBus`, and the ping consumer with
 * its repository (layered, no port: ADR-003). The pool comes from the global `DatabaseModule`.
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
    HeartbeatRepository,
    HeartbeatConsumer,
  ],
  exports: [MessageBus],
})
export class HeartbeatModule {}
