#!/usr/bin/env node
/**
 * Fails when this branch edits or deletes a migration that `main` already has (WP-10 "Never edit
 * an applied migration", from the step 3 check question). Drizzle's migrator applies only journal
 * entries newer than the last applied one and never compares the stored hash, so an edited file is
 * silently skipped in every database that already ran it, while every database built from zero
 * gets the new text: schema drift by environment. The fix is always a new migration.
 *
 * Rules, for files under `apps/<service>/drizzle/`, comparing the merge base with `main` against
 * the working tree (commits, staged and unstaged changes):
 * - a new file is fine, unless `main` already has a file of that name with other content (merge
 *   `main`, delete yours and run `db:generate` again);
 * - `meta/_journal.json` may only grow: `main`'s entries must stay, unchanged and first;
 * - any other change (modified, deleted, renamed, type changed) fails.
 *
 * The same migrator applies, in one transaction, only the journal entries whose `when` is greater
 * than the `created_at` of the newest row in `drizzle.__drizzle_migrations` (drizzle-orm
 * `pg-core/dialect.js`). So an entry whose `when` is not above every earlier entry's (a hand-merged
 * `_journal.json`, a migration generated before `main` gained a newer one) is skipped silently in
 * every database that already ran the later one (WP-12 step 1c). For every service's journal in
 * the working tree:
 * - entries are in `idx` order 0..n with no gap, each `tag` starts with its padded `idx`, and
 *   `when` is strictly increasing;
 * - every entry the branch adds (a tag `main`'s journal lacks) has a `when` above the last one on
 *   `main`.
 *
 * Base: `origin/main`, else `main`; with neither (a shallow clone) the checks against it print a
 * notice and pass, while the order check still runs.
 * Usage: pnpm check:migrations (part of pnpm verify and pnpm verify:all). It runs after Turborepo,
 * not as a cached task: its input is git history, which no cache key sees.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A path under a service's migration folder. */
export const MIGRATION_PATH = /^apps\/[^/]+\/drizzle\//;

/** A service's migration journal. */
const JOURNAL_PATH = /^apps\/[^/]+\/drizzle\/meta\/_journal\.json$/;

/** The fix for an entry the migrator would skip. */
const REGENERATE = "regenerate the migration after rebasing: delete it and run db:generate again";

/**
 * Parses `git diff --name-status --no-renames` output.
 * @param {string} output
 * @returns {{ status: string, path: string }[]}
 */
export function parseNameStatus(output) {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status.charAt(0), path: rest.join("\t") };
    });
}

/**
 * Whether a journal only grew: same version and dialect, and the base's entries are the first
 * entries of the current one, unchanged.
 * @param {string} baseText the journal on the merge base.
 * @param {string} currentText the journal in the working tree.
 * @returns {boolean}
 */
export function journalOnlyGrew(baseText, currentText) {
  let base;
  let current;
  try {
    base = JSON.parse(baseText);
    current = JSON.parse(currentText);
  } catch {
    return false;
  }
  if (base.version !== current.version || base.dialect !== current.dialect) return false;
  const baseEntries = Array.isArray(base.entries) ? base.entries : [];
  const currentEntries = Array.isArray(current.entries) ? current.entries : [];
  return baseEntries.every(
    (entry, index) => JSON.stringify(entry) === JSON.stringify(currentEntries[index]),
  );
}

/**
 * Decides which changes break the rules. Pure: git is read by the caller.
 * @param {{ status: string, path: string }[]} changes merge base against the working tree.
 * @param {object} facts
 * @param {(path: string) => boolean} facts.journalOnlyGrew whether a modified journal only grew.
 * @param {(path: string) => boolean} facts.differsOnBase whether an added path also exists on the
 *   base with other content.
 * @returns {string[]} one line per violation; empty when the branch only added migrations.
 */
export function migrationViolations(changes, facts) {
  const problems = [];
  for (const { status, path } of changes) {
    if (!MIGRATION_PATH.test(path)) continue;
    if (status === "A") {
      if (facts.differsOnBase(path)) {
        problems.push(
          `${path}: main has another file of this name; merge main, delete yours and run db:generate again`,
        );
      }
    } else if (status === "M" && JOURNAL_PATH.test(path)) {
      if (!facts.journalOnlyGrew(path)) {
        problems.push(`${path}: entries main already has were changed, removed or reordered`);
      }
    } else if (status === "D") {
      problems.push(`${path}: deleted, but main already has it`);
    } else {
      problems.push(`${path}: changed (${status}), but main already has it`);
    }
  }
  return problems;
}

/**
 * Parses a journal's entries, or returns null when the text is not a journal.
 * @param {string} text
 * @returns {{ idx: unknown, when: unknown, tag: unknown }[] | null}
 */
function journalEntries(text) {
  try {
    const journal = JSON.parse(text);
    return Array.isArray(journal?.entries) ? journal.entries : null;
  } catch {
    return null;
  }
}

/**
 * Checks that the migrator would apply every entry of a journal in order: `idx` runs 0..n with no
 * gap or duplicate, each `tag` starts with its `idx` padded to four digits (drizzle-kit's default
 * prefix), and `when` is a number strictly greater than the previous entry's. Pure.
 * @param {string} path the journal's path, for the messages.
 * @param {string} text the journal's content.
 * @returns {string[]} one line per problem; empty when the journal is in order.
 */
export function journalOrderProblems(path, text) {
  const entries = journalEntries(text);
  if (entries === null) return [`${path}: not a journal (invalid JSON or no entries array)`];
  const problems = [];
  let previous;
  entries.forEach((entry, position) => {
    const name = `entry ${entry?.tag ?? "(no tag)"} (idx ${entry?.idx})`;
    if (entry?.idx !== position) {
      problems.push(
        `${path}: ${name} sits at position ${position}; idx must run 0..n with no gap or duplicate; ${REGENERATE}`,
      );
    }
    const prefix = `${String(entry?.idx).padStart(4, "0")}_`;
    if (typeof entry?.tag !== "string" || !entry.tag.startsWith(prefix)) {
      problems.push(`${path}: ${name} has a tag that does not start with ${prefix}; ${REGENERATE}`);
    }
    if (typeof entry?.when !== "number") {
      problems.push(`${path}: ${name} has no numeric when; ${REGENERATE}`);
      return;
    }
    if (previous !== undefined && entry.when <= previous.when) {
      problems.push(
        `${path}: ${name} has when ${entry.when}, not after ${previous.tag} (${previous.when}); the migrator would skip it in a database that already ran ${previous.tag}; ${REGENERATE}`,
      );
    }
    previous = entry;
  });
  return problems;
}

/**
 * Checks that every entry the branch adds to a journal (a tag the base journal lacks) has a `when`
 * greater than the last `when` on the base: otherwise a database that already ran the base's newest
 * migration skips it after the merge. Pure; a missing or unreadable base journal (a new service)
 * passes.
 * @param {string} path the journal's path, for the messages.
 * @param {string | null} baseText the journal on `main`, or null when `main` has none.
 * @param {string} currentText the journal in the working tree.
 * @returns {string[]} one line per entry older than `main`'s last; empty otherwise.
 */
export function entriesOlderThanBase(path, baseText, currentText) {
  const baseEntries = baseText === null ? null : journalEntries(baseText);
  const currentEntries = journalEntries(currentText);
  if (!baseEntries || baseEntries.length === 0 || !currentEntries) return [];
  const baseTags = new Set(baseEntries.map((entry) => entry?.tag));
  const last = baseEntries.reduce((latest, entry) =>
    typeof entry?.when === "number" && entry.when > latest.when ? entry : latest,
  );
  return currentEntries
    .filter((entry) => !baseTags.has(entry?.tag))
    .filter((entry) => typeof entry?.when === "number" && entry.when <= last.when)
    .map(
      (entry) =>
        `${path}: entry ${entry.tag} has when ${entry.when}, not after main's last ${last.tag} (${last.when}); every database that ran ${last.tag} would skip it; merge main, then ${REGENERATE}`,
    );
}

/**
 * Lists every service's migration journal in the working tree, tracked or not.
 * @returns {string[]} paths relative to the repository root.
 */
function journalPaths() {
  if (!existsSync("apps")) return [];
  return readdirSync("apps", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `apps/${entry.name}/drizzle/meta/_journal.json`)
    .filter((path) => existsSync(path));
}

/**
 * Prints one group of problems under its heading and marks the run as failed.
 * @param {string} heading
 * @param {string[]} problems
 */
function report(heading, problems) {
  if (problems.length === 0) return;
  console.error(`check:migrations: ${heading}\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exitCode = 1;
}

/** Runs git and returns its output, or null when it fails. */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Runs the checks on this repository and exits 1 on a violation. */
function main() {
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (root) process.chdir(root);
  const journals = journalPaths().map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const skipHeading =
    "the migrator applies only journal entries newer than the last one applied, so these would be skipped silently (WP-12 step 1c).";
  const ordered = [];
  const orderProblems = journals.flatMap((journal) => {
    const problems = journalOrderProblems(journal.path, journal.text);
    if (problems.length === 0) ordered.push(journal);
    return problems;
  });
  report(skipHeading, orderProblems);
  const base = ["origin/main", "main"].find(
    (ref) => git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null,
  );
  if (!base) {
    console.log(
      "check:migrations: base checks skipped, neither origin/main nor main exists in this clone",
    );
    return;
  }
  const mergeBase = git(["merge-base", base, "HEAD"])?.trim();
  if (!mergeBase) {
    console.log(`check:migrations: base checks skipped, no merge base with ${base}`);
    return;
  }
  const changes = parseNameStatus(
    git(["diff", "--name-status", "--no-renames", mergeBase, "--", "apps"]) ?? "",
  );
  report(
    "applied migrations are immutable; write a new migration instead (WP-10).",
    migrationViolations(changes, {
      journalOnlyGrew: (path) =>
        existsSync(path) &&
        journalOnlyGrew(git(["show", `${mergeBase}:${path}`]) ?? "", readFileSync(path, "utf8")),
      differsOnBase: (path) => {
        const onBase = git(["rev-parse", "--verify", "--quiet", `${base}:${path}`])?.trim();
        return Boolean(onBase) && onBase !== git(["hash-object", path])?.trim();
      },
    }),
  );
  // A journal out of order is already reported: regenerating its entry fixes both rules.
  report(
    skipHeading,
    ordered.flatMap(({ path, text }) =>
      entriesOlderThanBase(path, git(["show", `${base}:${path}`]), text),
    ),
  );
  if (process.exitCode !== 1) console.log(`check:migrations: ok (base ${base})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
