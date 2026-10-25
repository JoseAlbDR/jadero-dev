import type {
  contentArchivedV1,
  contentPublishedV1,
  knowledgeEntryApprovedV1,
  knowledgeEntryWithdrawnV1,
  RevalidateChange,
} from "@jadero/contracts";
import type { z } from "zod";

type Published = z.output<(typeof contentPublishedV1)["data"]>;
type Archived = z.output<(typeof contentArchivedV1)["data"]>;
type Approved = z.output<(typeof knowledgeEntryApprovedV1)["data"]>;
type Withdrawn = z.output<(typeof knowledgeEntryWithdrawnV1)["data"]>;

/*
 * What each content event means for web's cache, as content facts (WP-14 Q1 B): the kind and id of
 * what changed, plus the localized slug where web tags an item page by it (projects and posts).
 * Never a cache tag: web maps each change to its own tags. The event's document is not read; for
 * revalidation the event is a notification, and web reads the new state from the content API.
 */

/**
 * @param data a `content.published.v1` event's data: one locale of one item went live.
 * @returns one change; a project or a post carries the localized slug the locale was published under.
 */
export function changesForPublished(data: Published): RevalidateChange[] {
  switch (data.aggregate) {
    case "project":
      return [{ kind: "project", id: data.id, slug: data.document.slug }];
    case "post":
      return [{ kind: "post", id: data.id, slug: data.document.slug }];
    case "cv-bullet":
      return [{ kind: "cv-bullet", id: data.id }];
    default:
      return [{ kind: data.aggregate, id: data.id }];
  }
}

/**
 * @param data a `content.archived.v1` event's data: one item left every public read.
 * @returns one change per distinct published slug of a project or a post (es and en may share
 *   one), or one change for an item web does not tag by slug. A project or post with no published
 *   slug yields none: the producer never emits that, so the consumer dead-letters it.
 */
export function changesForArchived(data: Archived): RevalidateChange[] {
  switch (data.aggregate) {
    case "project":
    case "post": {
      const slugs = [...new Set(Object.values(data.slugs).filter((s) => s !== undefined))];
      return slugs.map((slug) => ({ kind: data.aggregate, id: data.id, slug }));
    }
    case "cv-bullet":
      return [{ kind: "cv-bullet", id: data.id }];
    default:
      return [{ kind: data.aggregate, id: data.id }];
  }
}

/**
 * @param data a `knowledge.entry.approved.v1` or `knowledge.entry.withdrawn.v1` event's data.
 * @returns the entry, by its `kb-` id: web tags the work-log page by it, with no locale.
 */
export function changesForKnowledgeEntry(data: Approved | Withdrawn): RevalidateChange[] {
  return [{ kind: "knowledge-entry", id: data.entryId }];
}
