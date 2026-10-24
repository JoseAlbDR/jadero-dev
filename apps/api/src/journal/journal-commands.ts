import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DrizzleQueryError } from "drizzle-orm";
import { ZodError, z } from "zod";
import {
  type ImportJournalPost,
  LOCALES,
  type Locale,
  type PublishJournalPost,
} from "../modules/content/index.js";
import { parseJournalDraft } from "./journal-draft.js";

// The command-line half of the journal import (WP-39 D3): a driving adapter on the content use
// cases, like the admin will be (WP-17). It parses the arguments, reads the draft files, and prints
// one line per file or per publish. Lines name the WP, the locale and the outcome, never a body.

/** Where the command's lines go: `info` for outcomes, `error` for refusals and failures. */
export interface JournalOutput {
  info(line: string): void;
  error(line: string): void;
}

/** One draft file as read from disk. */
export interface JournalFile {
  /** The file name, `wp-12.md` or `wp-12.es.md`. */
  readonly name: string;
  readonly text: string;
}

/** `import [dir]` or `publish <wp> [locales...]`, validated. */
export type JournalArgs =
  | { readonly command: "import"; readonly dir: string }
  | { readonly command: "publish"; readonly wp: number; readonly locales: readonly Locale[] };

const importArgs = z.tuple([z.string().min(1)]).or(z.tuple([]));

const publishArgs = z
  .tuple([z.coerce.number<string>().int().min(1)])
  .rest(z.enum(LOCALES))
  .transform(([wp, ...locales]) => ({ wp, locales }));

/**
 * Validates the command line with Zod: `import [dir]`, or `publish <wp> [locales...]`.
 * @param argv the arguments after the script, `["import"]` or `["publish", "12", "en", "es"]`.
 * @param cwd the directory a relative `dir` is resolved from (where the owner ran pnpm).
 * @param defaultDir the drafts folder when `import` names none (the repo's `docs/journal`).
 * @returns the parsed command.
 * @throws {ZodError} when the command, the WP or a locale is malformed, or an argument is extra.
 */
export function parseJournalArgs(
  argv: readonly string[],
  cwd: string,
  defaultDir: string,
): JournalArgs {
  const [command, ...rest] = argv;
  if (command === "import") {
    const [dir] = importArgs.parse(rest);
    return { command, dir: dir === undefined ? defaultDir : resolve(cwd, dir) };
  }
  if (command === "publish") return { command, ...publishArgs.parse(rest) };
  throw new ZodError([
    {
      code: "custom",
      path: ["command"],
      message: "expected import or publish",
      input: command,
    },
  ]);
}

/**
 * Reads every Markdown draft in a folder, except its README, in work package order.
 * @param dir the drafts folder.
 * @returns the files with their text.
 * @throws when the folder cannot be read.
 */
export async function readJournalFiles(dir: string): Promise<JournalFile[]> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })),
  );
}

/**
 * Imports each draft through `ImportJournalPost`, one transaction per file, and prints one line per
 * file: `wp-12 en: created`, `revised`, `unchanged`, `refused: <reason>` or `failed: <error>`. A
 * refused or failed file does not stop the others. Never publishes.
 * @param files the drafts.
 * @param importPost the use case.
 * @param output where the lines go.
 * @returns how many files were refused or failed; 0 means every file imported.
 */
export async function importJournalFiles(
  files: readonly JournalFile[],
  importPost: Pick<ImportJournalPost, "execute">,
  output: JournalOutput,
): Promise<number> {
  let failures = 0;
  for (const file of files) {
    const draft = parseJournalDraft(file.text);
    if (!draft.ok) {
      output.error(`${draft.label ?? file.name}: refused: ${draft.reason}`);
      failures += 1;
      continue;
    }
    try {
      output.info(`${draft.label}: ${await importPost.execute(draft.command)}`);
    } catch (error) {
      output.error(`${draft.label}: failed: ${describeFailure(error)}`);
      failures += 1;
    }
  }
  return failures;
}

/**
 * Publishes the journal post of one work package through `PublishJournalPost`, so the domain's
 * guards apply (D-20: es and en live afterwards), and prints what went live, what was already live
 * and the warnings, or the refusal in one line.
 * @param wp the work package.
 * @param locales the locales to publish; empty means every locale with a pending draft.
 * @param publishPost the use case.
 * @param output where the lines go.
 * @returns true when the publish ran (even with nothing pending), false when it was refused.
 */
export async function publishJournal(
  wp: number,
  locales: readonly Locale[],
  publishPost: Pick<PublishJournalPost, "execute">,
  output: JournalOutput,
): Promise<boolean> {
  try {
    const result = await publishPost.execute({
      wp,
      locales: locales.length === 0 ? undefined : locales,
    });
    if (result.published.length === 0) {
      output.info(`wp-${wp}: nothing to publish`);
    } else {
      output.info(`wp-${wp}: published ${result.published.map((p) => p.locale).join(", ")}`);
    }
    if (result.alreadyPublished.length > 0) {
      output.info(`wp-${wp}: already live ${result.alreadyPublished.join(", ")}`);
    }
    for (const warning of result.warnings) {
      output.info(`wp-${wp}: warning: ${warning.locale} is not published`);
    }
    return true;
  } catch (error) {
    output.error(`wp-${wp}: not published: ${describeFailure(error)}`);
    return false;
  }
}

/**
 * A one-line description of a failure that carries no content: a query error's message holds its
 * bound parameters (document text), so only its driver code is printed; a validation error lists
 * its field paths and messages, never the values.
 * @param error what the command threw.
 * @returns the description.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    return `query failed (${typeof code === "string" ? code : "no code"})`;
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return `invalid input: ${issues.join("; ")}`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}
