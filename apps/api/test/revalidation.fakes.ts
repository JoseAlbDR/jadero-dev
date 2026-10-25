import type { RevalidateRequest } from "@jadero/contracts";
import type { PinoLogger } from "@jadero/platform-nest";
import type { Pool } from "pg";
import { RevalidationInbox } from "../src/modules/revalidation/revalidation-inbox.js";
import { WebCache, type WebCacheResult } from "../src/modules/revalidation/web-cache.js";

/**
 * Fakes at the revalidation module's edges, shared by its unit tests: web's cache (the port) and
 * the inbox repository (a layered module's plain class, replaced by an in-memory subclass, the way
 * the agent's heartbeat tests replace their repository). The real SQL and the real HTTP call run
 * in `revalidation.int.test.ts` and `revalidation-http.test.ts`.
 */

/** Records every call and answers with the next queued result, `revalidated` once they run out. */
export class FakeWebCache extends WebCache {
  readonly calls: { request: RevalidateRequest; traceparent: string | undefined }[] = [];
  private readonly results: WebCacheResult[] = [];

  /** @param results the answers of the next calls, in order. */
  answer(...results: WebCacheResult[]): this {
    this.results.push(...results);
    return this;
  }

  override async revalidate(
    request: RevalidateRequest,
    traceparent?: string,
  ): Promise<WebCacheResult> {
    this.calls.push({ request, traceparent });
    return this.results.shift() ?? { kind: "revalidated" };
  }
}

/** The inbox as a set of `consumer|eventId` keys. */
export class InMemoryRevalidationInbox extends RevalidationInbox {
  readonly rows = new Set<string>();

  constructor() {
    super({} as Pool);
  }

  override async has(consumer: string, eventId: string): Promise<boolean> {
    return this.rows.has(`${consumer}|${eventId}`);
  }

  override async record(consumer: string, envelope: { id: string }): Promise<void> {
    this.rows.add(`${consumer}|${envelope.id}`);
  }
}

/** A logger that keeps its debug lines, the only level the service writes itself. */
export function recordingLogger(): { log: PinoLogger; debug: unknown[][] } {
  const debug: unknown[][] = [];
  const log = {
    setContext: () => undefined,
    debug: (...args: unknown[]) => debug.push(args),
  } as unknown as PinoLogger;
  return { log, debug };
}
