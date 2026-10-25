import { type RevalidateChange, revalidateRequest } from "@jadero/contracts";
import { currentTraceparent, dead, done, type HandlerOutcome, retry } from "@jadero/messaging";
import { PinoLogger } from "@jadero/platform-nest";
import { Injectable } from "@nestjs/common";
import { RevalidationInbox } from "./revalidation-inbox.js";
import { WebCache } from "./web-cache.js";

/** The part of a delivery the revalidation needs: who it is for and which event it is. */
export interface RevalidationDelivery {
  readonly queue: string;
  readonly envelope: {
    readonly id: string;
    readonly type: string;
    readonly traceparent?: string | undefined;
  };
}

/**
 * Turns one content event into one call to web's cache, with the idempotent consumer's
 * check-act-record (WP-14 D5, ADR-012): look the event up in the inbox (a duplicate is done at
 * once), call web, then record the event. No transaction spans the call, so the effect can run
 * twice (a crash between the call and the record) but never zero times, which is safe because
 * dropping a tag twice changes nothing. A failed call records nothing, so its retry calls again.
 */
@Injectable()
export class RevalidationService {
  constructor(
    private readonly inbox: RevalidationInbox,
    private readonly web: WebCache,
    private readonly log: PinoLogger,
  ) {
    log.setContext("RevalidationService");
  }

  /**
   * Handles one delivery whose event maps to `changes`.
   * @param delivery the queue and the event's id, type and trace context.
   * @param changes what the event changed, as content facts (`revalidation-changes.ts`).
   * @returns `done` when web revalidated or the event was already handled, `retry` on a transient
   *   failure, `dead` when the changes are not a valid call or web refuses the call for good.
   */
  async revalidate(
    { queue, envelope }: RevalidationDelivery,
    changes: RevalidateChange[],
  ): Promise<HandlerOutcome> {
    const request = revalidateRequest.safeParse({ changes });
    if (!request.success) return dead(`no valid revalidation for ${envelope.type}`);
    if (await this.inbox.has(queue, envelope.id)) {
      this.log.debug({ event_id: envelope.id, type: envelope.type, queue }, "duplicate ignored");
      return done();
    }
    // The consumer's span when the broker's instrumentation made one, else the producer's context.
    const traceparent = currentTraceparent() ?? envelope.traceparent;
    const result = await this.web.revalidate(request.data, traceparent);
    if (result.kind === "transient") return retry(result.reason);
    if (result.kind === "permanent") return dead(result.reason);
    await this.inbox.record(queue, envelope);
    return done();
  }
}
