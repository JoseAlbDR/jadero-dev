import { z } from "zod";
import { defineEvent } from "../define-event.js";

/**
 * `system.ping.v1`: a probe that crosses the whole messaging path, `api` outbox to RabbitMQ to the
 * `agent` consumer (WP-5). `manual` comes from `POST /dev/ping` in development; `heartbeat` from
 * `api-worker` every 5 minutes, so the consumer's last-seen time shows the path works (decision W1 c).
 */
export const systemPingV1 = defineEvent(
  "system.ping.v1",
  z.object({
    trigger: z.enum(["manual", "heartbeat"]),
  }),
);
