#!/usr/bin/env node
/**
 * Writes one Markdown table of unit-test coverage per package (ADR-009 "reported per package in
 * CI", WP-6 D5). Each package's `test` task runs Vitest with the `json-summary` reporter, which
 * leaves `coverage/coverage-summary.json` in the package (a Turborepo cache hit replays it). This
 * script reads every one it finds and appends the table to the file named by `GITHUB_STEP_SUMMARY`,
 * the job summary on the run page, or prints it when that variable is unset (a local run).
 *
 * It never fails the job: the thresholds already did that inside `test`. A run where no package
 * was affected has no summary file, and the table says so. Only package names and percentages are
 * written: the summary files hold file paths and counts, nothing from a request.
 *
 * Usage: `node scripts/ci/coverage-summary.mjs`
 */
import { appendFileSync, existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where the workspace packages live (the `packages:` globs of `pnpm-workspace.yaml`). */
const SUMMARY_GLOBS = ["apps", "packages", "templates"].map(
  (folder) => `${folder}/*/coverage/coverage-summary.json`,
);

/**
 * Reads one percentage from a summary's `total`, or null when it is missing or not a number, so a
 * malformed file shows as "n/a" instead of crashing the step.
 * @param {unknown} total the `total` object of a coverage summary.
 * @param {"lines" | "branches"} metric which metric.
 * @returns {number | null} the percentage, or null.
 */
export function readPct(total, metric) {
  const pct = /** @type {{ [k: string]: { pct?: unknown } } | undefined} */ (total)?.[metric]?.pct;
  return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

/**
 * Finds every package's coverage summary under `root`.
 * @param {string} root the repository root.
 * @returns {{ name: string, lines: number | null, branches: number | null }[]} one row per package,
 *   sorted by name; a package whose summary cannot be parsed keeps its row with null values.
 */
export function collectRows(root) {
  const rows = [];
  for (const file of SUMMARY_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: root }))) {
    const packageDir = join(root, dirname(dirname(file)));
    const manifest = join(packageDir, "package.json");
    const name = existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, "utf8")).name ?? dirname(dirname(file)))
      : dirname(dirname(file));
    let total;
    try {
      total = JSON.parse(readFileSync(join(root, file), "utf8"))?.total;
    } catch {
      total = undefined;
    }
    rows.push({ name, lines: readPct(total, "lines"), branches: readPct(total, "branches") });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Renders the rows as the Markdown the job summary shows.
 * @param {{ name: string, lines: number | null, branches: number | null }[]} rows the packages.
 * @returns {string} a heading and a table, or a heading and one line when there are no rows.
 */
export function renderTable(rows) {
  const heading = "### Unit test coverage\n\n";
  if (rows.length === 0) return `${heading}No coverage summary: no package's tests ran.\n`;
  const pct = (/** @type {number | null} */ value) => (value === null ? "n/a" : `${value}%`);
  const lines = rows.map((row) => `| ${row.name} | ${pct(row.lines)} | ${pct(row.branches)} |`);
  return `${heading}| Package | Lines | Branches |\n|---|---:|---:|\n${lines.join("\n")}\n`;
}

/**
 * Collects the summaries and writes the table to the job summary, or to stdout locally.
 * @param {NodeJS.ProcessEnv} env the environment, for `GITHUB_STEP_SUMMARY`.
 * @param {string} root the repository root.
 */
export function main(env = process.env, root = ROOT) {
  const table = renderTable(collectRows(root));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${table}\n`);
  else process.stdout.write(table);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
