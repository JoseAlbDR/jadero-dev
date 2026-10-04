import { MessageBus, RabbitMqMessageBus } from "@jadero/messaging";
import { ReadinessCheck } from "@jadero/platform-nest";
import { Injectable } from "@nestjs/common";

/** Readiness of the broker connection, in the consumer process only (WP-5 decision W1). */
@Injectable()
export class BrokerReadinessCheck extends ReadinessCheck {
  readonly name = "broker";

  constructor(private readonly bus: MessageBus) {
    super();
  }

  /** Throws while the connection to RabbitMQ is down. */
  async check(): Promise<void> {
    if (this.bus instanceof RabbitMqMessageBus && !this.bus.isConnected()) {
      throw new Error("broker not connected");
    }
  }
}
