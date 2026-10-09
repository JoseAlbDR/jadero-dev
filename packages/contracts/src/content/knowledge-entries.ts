import { z } from "zod";
import { cvBulletId, knowledgeEntryId, slug } from "./params.js";
import { period, publishedText, tags } from "./shared.js";

/** The entry's `type`, the list of the agreed entry format (ADR-031 alignment). */
export const knowledgeEntryType = z.enum([
  "feature",
  "improvement",
  "tech-debt",
  "integration",
  "performance",
  "tooling",
  "workshop",
]);

/** The owner's real role in the work, from the agreed entry format. */
export const knowledgeEntryRole = z.enum(["sole author", "lead", "contributor"]);

/**
 * The keys of an entry's prose sections, in the fixed order of the format's headings: Summary,
 * Problem, What he built, How it works, Trade-offs and alternatives, Testing and rollout, Outcome,
 * Lessons. The ninth heading, Questions this answers, is the separate `questions` list. A key is
 * also the section's anchor in a citation (`/en/work/kb-...#tradeoffs`).
 */
export const knowledgeEntrySectionKey = z.enum([
  "summary",
  "problem",
  "whatHeBuilt",
  "howItWorks",
  "tradeoffs",
  "testingRollout",
  "outcome",
  "lessons",
]);

/** One section key. */
export type KnowledgeEntrySectionKey = z.infer<typeof knowledgeEntrySectionKey>;

const SECTION_ORDER = knowledgeEntrySectionKey.options;

/** The sections the tolerant importer requires (D-67); the others may be absent. */
const REQUIRED_SECTIONS: readonly KnowledgeEntrySectionKey[] = [
  "summary",
  "problem",
  "whatHeBuilt",
];

/** One prose section: its key and its body as raw Markdown. */
export const knowledgeEntrySection = z.object({
  key: knowledgeEntrySectionKey,
  body: publishedText,
});

/**
 * The prose sections in the format's order, each at most once; empty optional sections are left
 * out, and Summary, Problem and What he built are always present.
 */
export const knowledgeEntrySections = z
  .array(knowledgeEntrySection)
  .superRefine((sections, ctx) => {
    const positions = sections.map((s) => SECTION_ORDER.indexOf(s.key));
    for (let i = 1; i < positions.length; i++) {
      if ((positions[i] ?? 0) <= (positions[i - 1] ?? 0)) {
        ctx.addIssue({
          code: "custom",
          message: "Sections must follow the format's order, each at most once",
          path: [i, "key"],
        });
      }
    }
    for (const key of REQUIRED_SECTIONS) {
      if (!sections.some((s) => s.key === key)) {
        ctx.addIssue({ code: "custom", message: `Missing required section ${key}` });
      }
    }
  });

/**
 * The public front matter of an entry (D-67: indexed and shown). The private fields of the format,
 * `sources`, `conflicts`, `public_names` and `confidence`, are not part of any public schema, so a
 * response that carried them by mistake loses them when it is parsed (unknown keys are stripped).
 * `indexable: false` asks `web` for a `noindex` page (D-52).
 */
const entryMetadata = {
  id: knowledgeEntryId,
  title: publishedText,
  type: knowledgeEntryType,
  domain: slug,
  period,
  role: knowledgeEntryRole,
  stack: tags,
  patterns: tags,
  indexable: z.boolean(),
};

/** One approved entry in the work-log list: its metadata and its Summary. */
export const knowledgeEntrySummaryDto = z.object({
  ...entryMetadata,
  summary: publishedText,
});

/** A work-log card. */
export type KnowledgeEntrySummaryDto = z.infer<typeof knowledgeEntrySummaryDto>;

/** `GET /content/work`: every approved entry. Entries are English only, so no locale segment. */
export const knowledgeEntryListDto = z.object({ items: z.array(knowledgeEntrySummaryDto) });

/** The public work-log list. */
export type KnowledgeEntryListDto = z.infer<typeof knowledgeEntryListDto>;

/**
 * `GET /content/work/:entryId`: the approved revision of one entry (ADR-031). `cvBullet` is the one
 * CV bullet it details, or `null`; `related` are other entry ids; `questions` are the lines under
 * Questions this answers.
 */
export const knowledgeEntryDto = z.object({
  ...entryMetadata,
  cvBullet: cvBulletId.nullable(),
  related: z.array(knowledgeEntryId),
  sections: knowledgeEntrySections,
  questions: z.array(publishedText).min(1),
});

/** A public work-log page. */
export type KnowledgeEntryDto = z.infer<typeof knowledgeEntryDto>;
