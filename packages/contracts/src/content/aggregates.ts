import { z } from "zod";

/**
 * The content types `api` publishes per locale (ADR-011), as the events and the revalidation call
 * name them: the two singletons (`profile`, `now`) and the five item types. The same names as the
 * `type` of `api`'s content commands, so a producer copies the value instead of mapping it.
 */
export const contentAggregate = z.enum([
  "profile",
  "now",
  "experience-item",
  "project",
  "post",
  "skill",
  "cv-bullet",
]);

/** One publishable content type. */
export type ContentAggregate = z.infer<typeof contentAggregate>;

/**
 * The content types that can be archived: every one but the singletons, which have no archive (a
 * singleton with no restore would lock itself).
 */
export const archivableAggregate = contentAggregate.exclude(["profile", "now"]);

/** One archivable content type. */
export type ArchivableAggregate = z.infer<typeof archivableAggregate>;
