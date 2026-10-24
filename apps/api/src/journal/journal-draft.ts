import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { type ImportJournalPostCommand, LOCALES } from "../modules/content/index.js";

// The parsing half of the journal import (WP-39 D3): a draft file in `docs/journal/` becomes one
// `ImportJournalPost` command, or a one-line reason to refuse it. Pure functions, no I/O, so the
// rules are tested without a database. Reasons name the field, never the text of the draft.

/** The marker `/wrap-wp` leaves on a sentence where the agent guessed the owner's opinion. */
export const OWNER_CHECK_MARKER = "<!-- owner: check -->";

/** U+2014: the content rules (ADR-031, ADR-034) allow no em dash in a journal post. */
export const EM_DASH = "\u2014";

/** The longest localized slug the import derives from a title, cut at a word boundary. */
export const SLUG_MAX = 100;

/** The longest excerpt the import derives from the first paragraph; also the page's description. */
export const EXCERPT_MAX = 200;

/** The front matter of a journal draft (`docs/journal/README.md`). */
const frontMatterSchema = z.object({
  wp: z.int().min(1),
  title: z.string().trim().min(1).max(200),
  status: z.enum(["draft", "approved"]),
  date: z.iso.date(),
  locale: z.enum(LOCALES),
});

/** A draft's front matter, validated. */
export type JournalFrontMatter = z.output<typeof frontMatterSchema>;

/** A draft the import can hand to `ImportJournalPost`, with the label its output line uses. */
export interface ParsedJournalDraft {
  readonly ok: true;
  /** `wp-12 en`, from the front matter. */
  readonly label: string;
  readonly frontMatter: JournalFrontMatter;
  readonly command: ImportJournalPostCommand;
}

/** A draft the import refuses, with a reason that never quotes the draft's text. */
export interface RefusedJournalDraft {
  readonly ok: false;
  /** `wp-12 en` once the front matter is valid, else undefined (the caller uses the file name). */
  readonly label: string | undefined;
  readonly reason: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/**
 * Parses one journal draft: YAML front matter validated with Zod, the body with its title heading
 * dropped, and the post document derived from both (localized slug from the title, excerpt from the
 * first paragraph, no tags). Both statuses import, as draft revisions; a draft that still holds an
 * owner check marker is refused, so no guessed opinion reaches the database (ADR-034), and so is
 * one whose title, body or excerpt holds an em dash, which the content rules forbid.
 * @param text the whole file.
 * @returns the command to import, or the reason to refuse it.
 */
export function parseJournalDraft(text: string): ParsedJournalDraft | RefusedJournalDraft {
  const match = FRONT_MATTER.exec(text);
  if (!match) return refused(undefined, "no front matter between --- lines at the top");
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch {
    return refused(undefined, "front matter is not valid YAML");
  }
  const parsed = frontMatterSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "front matter"}: ${issue.message}`,
    );
    return refused(undefined, `front matter ${issues.join("; ")}`);
  }
  const frontMatter = parsed.data;
  const label = `wp-${frontMatter.wp} ${frontMatter.locale}`;
  if (text.includes(OWNER_CHECK_MARKER)) {
    return refused(label, `holds an ${OWNER_CHECK_MARKER} marker; review it first`);
  }
  const body = withoutTitleHeading(match[2] ?? "", frontMatter.title);
  // The excerpt comes from the body, so checking the title and the body covers all three texts.
  if (frontMatter.title.includes(EM_DASH) || body.includes(EM_DASH)) {
    return refused(label, "holds an em dash; use a comma, colon or new sentence");
  }
  if (body.length === 0) return refused(label, "the body is empty");
  const slug = slugFromTitle(frontMatter.title);
  if (slug.length === 0) return refused(label, "the title gives no slug (no letters or digits)");
  return {
    ok: true,
    label,
    frontMatter,
    command: {
      wp: frontMatter.wp,
      locale: frontMatter.locale,
      document: { slug, title: frontMatter.title, excerpt: excerptOf(body), body, tags: [] },
    },
  };
}

/**
 * Drops the first level-one heading when it repeats the title, since the page renders the title
 * itself; any other heading stays.
 * @param body the Markdown after the front matter.
 * @param title the draft's title.
 * @returns the body without that heading, trimmed.
 */
export function withoutTitleHeading(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => /^#\s/.test(line));
  if (index !== -1 && lines[index]?.replace(/^#\s+/, "").trim() === title.trim()) {
    lines.splice(index, 1);
  }
  return lines.join("\n").trim();
}

/**
 * A URL slug from a title: accents dropped, lowercase letters and digits joined by single hyphens,
 * cut at a word boundary so it fits `max` (the domain's slug rule allows 120).
 * @param title the title, in any of the content locales.
 * @param max the longest slug.
 * @returns the slug, or an empty string when the title has no letter or digit.
 */
export function slugFromTitle(title: string, max = SLUG_MAX): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  let slug = "";
  for (const word of words) {
    const next = slug.length === 0 ? word : `${slug}-${word}`;
    if (next.length > max) break;
    slug = next;
  }
  return slug.length === 0 ? (words[0]?.slice(0, max) ?? "") : slug;
}

/**
 * The excerpt of a post: its first paragraph of prose (not a heading, list, quote, table, code or
 * HTML block) as plain text, without Markdown emphasis, code ticks or link targets, cut at a word
 * boundary with an ellipsis when longer than `max`.
 * @param body the post's Markdown, title heading already dropped.
 * @param max the longest excerpt.
 * @returns the excerpt, or an empty string when the body has no paragraph.
 */
export function excerptOf(body: string, max = EXCERPT_MAX): string {
  const paragraph = body
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !/^(#|[-*+]\s|\d+\.\s|>|```|~~~|\||<)/.test(block));
  if (paragraph === undefined) return "";
  const text = paragraph
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\*([^*\s][^*]*)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // A cut that ends right before a space ends on a whole word; otherwise drop the partial word.
  const whole = text[max - 1] === " " || space <= 0 ? cut : cut.slice(0, space);
  return `${whole.replace(/[\s,;:.]+$/, "")}…`;
}

function refused(label: string | undefined, reason: string): RefusedJournalDraft {
  return { ok: false, label, reason };
}
