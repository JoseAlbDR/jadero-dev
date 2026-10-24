import { z } from "zod";
import { knowledgeEntryDto } from "../content/knowledge-entries.js";
import { locale } from "../content/locale.js";
import { knowledgeEntryId } from "../content/params.js";
import { defineEvent } from "../define-event.js";
import { revisionRef } from "./content-published.v1.js";

/**
 * How sure the owner is of an entry's facts (D-67). The one provenance field that leaves `api`: the
 * agent needs it to hedge an answer ("according to the design notes").
 */
export const knowledgeEntryConfidence = z.enum(["high", "medium", "low"]);

/**
 * `knowledge.entry.approved.v1`: one revision of a knowledge entry passed the approval gate
 * (ADR-031), written in the approval transaction through the outbox; approving an entry that is
 * already approved writes none. The agent's read model (WP-20) ingests `document`, the public
 * revision (the same fields as `GET /v1/content/work/:entryId` without the id), plus `confidence`.
 *
 * The private provenance, `sources`, `conflicts` and `publicNames`, is not in this schema, so a
 * producer bug that put it in the data is stripped by every consumer's parse, and a field that is
 * not in the event cannot leak from a consumer's logs or database. `approval.state` is what the
 * consumer's own check of ADR-031 reads. `locale` is `en` until per-locale entries arrive (WP-57),
 * required from the start so that change needs no new version. `revision.number` orders versions.
 */
export const knowledgeEntryApprovedV1 = defineEvent(
  "knowledge.entry.approved.v1",
  z.object({
    entryId: knowledgeEntryId,
    locale,
    revision: revisionRef,
    approval: z.object({
      state: z.literal("approved"),
      approvedAt: z.iso.datetime({ offset: true }),
    }),
    document: knowledgeEntryDto.omit({ id: true }),
    confidence: knowledgeEntryConfidence,
  }),
);
