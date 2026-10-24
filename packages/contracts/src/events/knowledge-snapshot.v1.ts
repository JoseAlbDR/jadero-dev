import { z } from "zod";
import { locale } from "../content/locale.js";
import { knowledgeEntryId } from "../content/params.js";
import { defineEvent } from "../define-event.js";

/**
 * `knowledge.snapshot.v1`: once a day, every approved knowledge entry revision as of one moment
 * (ADR-031 check 3, WP-14 D7), so a read model can find and remove what it holds that is no longer
 * approved (anti-entropy). `asOf` is the time of the transaction that read the list: an entry
 * approved after it may reach a consumer before the snapshot does, so a consumer only removes
 * entries it ingested before `asOf`. Ids only, no documents.
 */
export const knowledgeSnapshotV1 = defineEvent(
  "knowledge.snapshot.v1",
  z.object({
    asOf: z.iso.datetime({ offset: true }),
    entries: z.array(
      z.object({
        entryId: knowledgeEntryId,
        locale,
        revisionId: z.uuid(),
      }),
    ),
  }),
);
