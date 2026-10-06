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
 * Base: `origin/main`, else `main`; with neither (a shallow clone) it prints a notice and passes.
 * Usage: pnpm check:migrations (part of pnpm verify and pnpm verify:all). It runs after Turborepo,
 * not as a cached task: its input is git history, which no cache key sees.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A path under a service's migration folder. */
export const MIGRATION_PATH = /^apps\/[^/]+\/drizzle\//;

/** A service's migration journal. */
const JOURNAL_PATH = /^apps\/[^/]+\/drizzle\/meta\/_journal\.json$/;

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

/** Runs git and returns its output, or null when it fails. */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Runs the check on this repository and exits 1 on a violation. */
function main() {
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (root) process.chdir(root);
  const base = ["origin/main", "main"].find(
    (ref) => git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null,
  );
  if (!base) {
    console.log("check:migrations: skipped, neither origin/main nor main exists in this clone");
    return;
  }
  const mergeBase = git(["merge-base", base, "HEAD"])?.trim();
  if (!mergeBase) {
    console.log(`check:migrations: skipped, no merge base with ${base}`);
    return;
  }
  const changes = parseNameStatus(
    git(["diff", "--name-status", "--no-renames", mergeBase, "--", "apps"]) ?? "",
  );
  const problems = migrationViolations(changes, {
    journalOnlyGrew: (path) =>
      existsSync(path) &&
      journalOnlyGrew(git(["show", `${mergeBase}:${path}`]) ?? "", readFileSync(path, "utf8")),
    differsOnBase: (path) => {
      const onBase = git(["rev-parse", "--verify", "--quiet", `${base}:${path}`])?.trim();
      return Boolean(onBase) && onBase !== git(["hash-object", path])?.trim();
    },
  });
  if (problems.length > 0) {
    console.error(
      `check:migrations: applied migrations are immutable; write a new migration instead (WP-10).\n${problems.map((line) => `  ${line}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`check:migrations: ok (base ${base})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
