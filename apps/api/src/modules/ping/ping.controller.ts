import { Controller, HttpCode, Post } from "@nestjs/common";
import { PingService } from "./ping.service.js";

/**
 * `POST /dev/ping`, registered only when `NODE_ENV=development` (WP-5 decision W1 c): one request
 * starts a trace that runs through the outbox, the relay, RabbitMQ and the `agent` consumer. Never
 * public: anyone could fill the queues.
 */
@Controller("dev")
export class PingController {
  constructor(private readonly ping: PingService) {}

  /** @returns 202 with the event id; the event is published by the relay within about a second. */
  @Post("ping")
  @HttpCode(202)
  async send(): Promise<{ eventId: string }> {
    return { eventId: await this.ping.send("manual") };
  }
}
