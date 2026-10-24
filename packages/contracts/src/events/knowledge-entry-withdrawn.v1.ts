import { z } from "zod";
import { locale } from "../content/locale.js";
import { knowledgeEntryId } from "../content/params.js";
import { defineEvent } from "../define-event.js";

/**
 * `knowledge.entry.withdrawn.v1`: a tombstone, one locale of a knowledge entry is no longer public
 * (ADR-031), written in the withdraw or delete transaction through the outbox. `reason` says which:
 * `withdrawn` may come back later as a new approved revision, `deleted` is final. No document: a read model removes
 * what it holds for `entryId` and `locale`. `at` is when it happened.
 */
export const knowledgeEntryWithdrawnV1 = defineEvent(
  "knowledge.entry.withdrawn.v1",
  z.object({
    entryId: knowledgeEntryId,
    locale,
    reason: z.enum(["withdrawn", "deleted"]),
    at: z.iso.datetime({ offset: true }),
  }),
);
