import type { RevalidateChange } from "@jadero/contracts";
import { contentTags } from "./api";

/**
 * web's own mapping from what changed in `api` to the cache tags of `src/content/api.ts` (WP-14
 * Q1 B: the tags are web's internals, so a new page or a renamed tag changes only this file). Each
 * change drops its list tag, plus its item tag where web caches the item on its own. A knowledge
 * entry also drops the experience list, whose CV bullets carry the ids of the entries that name
 * them. Over-invalidating is the safe side: a dropped tag costs one read from the content API.
 * @param change one changed item.
 * @returns the tags that hold it.
 */
export function tagsForChange(change: RevalidateChange): string[] {
  switch (change.kind) {
    case "profile":
      return [contentTags.profile];
    case "now":
      return [contentTags.now];
    case "experience-item":
    case "cv-bullet":
      return [contentTags.experience];
    case "project":
      return [contentTags.projects, contentTags.project(change.slug)];
    case "post":
      return [contentTags.posts, contentTags.post(change.slug)];
    case "skill":
      return [contentTags.skills];
    case "knowledge-entry":
      return [contentTags.work, contentTags.workEntry(change.id), contentTags.experience];
  }
}

/**
 * @param changes the changes of one revalidation call.
 * @returns every tag they hold, each once, in first-seen order.
 */
export function tagsForChanges(changes: readonly RevalidateChange[]): string[] {
  return [...new Set(changes.flatMap(tagsForChange))];
}
