import type { KnowledgeEntryDto } from "@jadero/contracts";
import type { Root, RootContent } from "hast";
import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { markdownToHast } from "@/markdown/markdown";

/*
 * Mappings of the work-log pages (ADR-031, D-50, D-52): approved knowledge entries, English only,
 * addressed by their stable id. Kept out of the pages so they are unit tested.
 */

/** The language every work-log entry is written in (D-50): entries are English only. */
export const ENTRY_LOCALE = "en" satisfies Locale;

/**
 * The anchor of the Questions this answers list. The prose sections use their contract key as
 * their anchor (`#tradeoffs`, `#whatHeBuilt`), the target of a citation (ADR-031).
 */
export const QUESTIONS_ANCHOR = "questions";

/** The message key of each role under `WorkPage.role` (a key with a space reads badly). */
const ROLE_KEYS = {
  "sole author": "soleAuthor",
  lead: "lead",
  contributor: "contributor",
} as const satisfies Record<KnowledgeEntryDto["role"], string>;

/**
 * The message key of an entry's role.
 * @param role the `role` of the entry (`sole author`, `lead`, `contributor`).
 * @returns its key under `WorkPage.role`.
 */
export function roleKey(role: KnowledgeEntryDto["role"]): (typeof ROLE_KEYS)[typeof role] {
  return ROLE_KEYS[role];
}

/**
 * The `robots` metadata of an entry page (D-52): an entry with `indexable: false` stays out of
 * search results but its links are still followed (`noindex, follow`); an indexable one sets
 * nothing and inherits the site's default.
 * @param indexable the entry's `indexable` flag.
 * @returns the `robots` field, or `undefined` for an indexable entry.
 */
export function entryRobots(indexable: boolean): Metadata["robots"] {
  return indexable ? undefined : { index: false, follow: true };
}

/**
 * The text of a Markdown body without its markup, for a meta description: the body goes through
 * the safe pipeline first, so nothing the sanitizer drops (raw HTML, scripts) can reach the
 * `<meta>` tag, and whitespace is collapsed to single spaces.
 * @param source the raw Markdown, for example the entry's Summary.
 * @returns the plain text.
 */
export function markdownPlainText(source: string): string {
  return textOf(markdownToHast(source)).replace(/\s+/g, " ").trim();
}

/** The text nodes of a hast tree, in order; block elements are already separated by newlines. */
function textOf(node: Root | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

/**
 * The description of an entry page: the plain text of its Summary, which the contract requires.
 * @param entry the entry from the content API.
 * @returns the description, empty only if the Summary has no text.
 */
export function entryDescription(entry: Pick<KnowledgeEntryDto, "sections">): string {
  const summary = entry.sections.find((section) => section.key === "summary");
  return summary ? markdownPlainText(summary.body) : "";
}
