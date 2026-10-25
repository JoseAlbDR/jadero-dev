import { z } from "zod";
import { locale } from "../content/locale.js";
import { knowledgeEntryId } from "../content/params.js";
import { defineEvent } from "../define-event.js";
import { revisionRef } from "./content-published.v1.js";

/**
 * `knowledge.entry.withdrawn.v1`: a tombstone, one locale of a knowledge entry is no longer public
 * (ADR-031), written in the withdraw or delete transaction through the outbox, only when an approved
 * revision was live. `reason` says which: `withdrawn` may come back later as a new approved revision,
 * `deleted` is final. No document: a read model removes what it holds for `entryId` and `locale`.
 * `at` is when it happened.
 *
 * `revision` is the approved revision that was live when the entry was withdrawn or deleted. Delivery
 * order is not promised (a tombstone held in a retry tier can arrive after a later approval), so a
 * consumer ignores a tombstone whose `revision.number` is lower than the one it holds for the same
 * `entryId` and `locale`, the same rule as `knowledge.entry.approved.v1`.
 */
export const knowledgeEntryWithdrawnV1 = defineEvent(
  "knowledge.entry.withdrawn.v1",
  z.object({
    entryId: knowledgeEntryId,
    locale,
    revision: revisionRef,
    reason: z.enum(["withdrawn", "deleted"]),
    at: z.iso.datetime({ offset: true }),
  }),
);
