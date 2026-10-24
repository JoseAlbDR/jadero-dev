import { contentArchivedV1 } from "./content-archived.v1.js";
import { contentPublishedV1 } from "./content-published.v1.js";
import { knowledgeEntryApprovedV1 } from "./knowledge-entry-approved.v1.js";
import { knowledgeEntryWithdrawnV1 } from "./knowledge-entry-withdrawn.v1.js";
import { knowledgeSnapshotV1 } from "./knowledge-snapshot.v1.js";
import { systemPingV1 } from "./system-ping.v1.js";

export { contentArchivedV1 } from "./content-archived.v1.js";
export { contentPublishedV1, revisionRef } from "./content-published.v1.js";
export {
  knowledgeEntryApprovedV1,
  knowledgeEntryConfidence,
} from "./knowledge-entry-approved.v1.js";
export { knowledgeEntryWithdrawnV1 } from "./knowledge-entry-withdrawn.v1.js";
export { knowledgeSnapshotV1 } from "./knowledge-snapshot.v1.js";
export { systemPingV1 } from "./system-ping.v1.js";

/** Every event contract, the list the AsyncAPI catalog and the topology are built from. */
export const eventContracts = [
  systemPingV1,
  contentPublishedV1,
  contentArchivedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
  knowledgeSnapshotV1,
] as const;
