import {
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
} from "@jadero/contracts";
import { cleanupInbox, MessageBus } from "@jadero/messaging";
import { PG_POOL } from "@jadero/platform-nest";
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import { Pool } from "pg";
import { RevalidationService } from "./revalidation.service.js";
import {
  changesForArchived,
  changesForKnowledgeEntry,
  changesForPublished,
} from "./revalidation-changes.js";

/** The queue this consumer reads; it exists in `infra/rabbitmq/definitions.json` (WP-14 step 4). */
export const REVALIDATE_QUEUE = "api.revalidate";

/** How often inbox rows past their retention (30 days, WP-5 decision I1) are deleted. */
export const INBOX_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The driving side of revalidation in `api-worker` (ADR-029: revalidation is a process type of
 * `api`; WP-14 D4): subscribes to the four content events bound to `api.revalidate`, maps each to
 * its changes and hands them to {@link RevalidationService}. The bus parses every envelope with its
 * contract first, so a malformed event is dead before it gets here. Starts consuming once the app
 * is up, cleans the inbox daily, and stops before the pool closes; the relay closes the bus.
 */
@Injectable()
export class RevalidationConsumer
  implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown
{
  private cleanup: NodeJS.Timeout | undefined;

  constructor(
    private readonly bus: MessageBus,
    private readonly revalidation: RevalidationService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Nest lifecycle hook: registers one subscription per event type on the queue. */
  onModuleInit(): void {
    this.bus.subscribe({
      queue: REVALIDATE_QUEUE,
      contract: contentPublishedV1,
      handle: (delivery) =>
        this.revalidation.revalidate(delivery, changesForPublished(delivery.envelope.data)),
    });
    this.bus.subscribe({
      queue: REVALIDATE_QUEUE,
      contract: contentArchivedV1,
      handle: (delivery) =>
        this.revalidation.revalidate(delivery, changesForArchived(delivery.envelope.data)),
    });
    for (const contract of [knowledgeEntryApprovedV1, knowledgeEntryWithdrawnV1]) {
      this.bus.subscribe({
        queue: REVALIDATE_QUEUE,
        contract,
        handle: (delivery) =>
          this.revalidation.revalidate(delivery, changesForKnowledgeEntry(delivery.envelope.data)),
      });
    }
  }

  /** Nest lifecycle hook: starts consuming (never waits for the broker) and the daily inbox cleanup. */
  async onApplicationBootstrap(): Promise<void> {
    await this.bus.start();
    const clean = () => void cleanupInbox(this.pool).catch(() => undefined);
    clean();
    this.cleanup = setInterval(clean, INBOX_CLEANUP_INTERVAL_MS);
  }

  /** Nest lifecycle hook: stops consuming and lets deliveries in progress (and their call) finish. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.cleanup) clearInterval(this.cleanup);
    await this.bus.stop();
  }
}
