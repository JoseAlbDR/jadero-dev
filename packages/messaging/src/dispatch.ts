import { cloudEventEnvelope, type EventContract } from "@jadero/contracts";
import type { z } from "zod";
import { errorKind } from "./error-kind.js";
import type { Subscription } from "./message-bus.js";
import { dead, type HandlerOutcome, retry } from "./outcome.js";

/**
 * Parses one raw delivery and runs the matching handler, the part every adapter shares so they
 * behave the same. A body that is not a valid envelope, a type no subscription accepts, or data
 * that fails the contract is `dead` at once: retrying cannot fix a bad payload. A handler that
 * throws is `retry`. Reasons name the failing fields, never their values (no bodies in logs).
 * @param subscriptions the subscriptions of the queue the message came from.
 * @param body the decoded message body.
 * @param attempt which delivery this is, starting at 1.
 * @param queue the queue name, passed to the handler.
 * @returns the outcome to dispose of.
 */
export async function dispatch(
  subscriptions: readonly Subscription<EventContract<string, z.ZodType>>[],
  body: unknown,
  attempt: number,
  queue: string,
): Promise<HandlerOutcome> {
  const base = cloudEventEnvelope.safeParse(body);
  if (!base.success) return dead(`invalid envelope: ${fields(base.error)}`);
  const subscription = subscriptions.find((s) => s.contract.type === base.data.type);
  if (!subscription) return dead(`no handler for ${base.data.type} on ${queue}`);
  const parsed = subscription.contract.envelope.safeParse(body);
  if (!parsed.success) return dead(`invalid ${base.data.type}: ${fields(parsed.error)}`);
  try {
    return await subscription.handle({ envelope: parsed.data, attempt, queue });
  } catch (error) {
    return retry(error instanceof Error ? errorKind(error) : "handler threw");
  }
}

function fields(error: z.ZodError): string {
  return error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
}
