#!/usr/bin/env node
/**
 * Regenerates the ADR table in docs/adr/README.md from the front matter of every
 * docs/adr/NNNN-*.md file (the template 0000 is skipped). Only the text between the markers
 * `<!-- adr-index:start -->` and `<!-- adr-index:end -->` changes.
 *
 * Usage: pnpm adr:index            rewrite the table
 *        pnpm adr:index --check    exit 1 when the table is stale, change nothing (for CI)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Front matter reader: only the flat YAML the ADR template uses (`key: value`, double-quoted
// strings, `null`, one-line lists such as `[D-1, D-2]`). WP-1 decision K: no dependencies.

/**
 * Parses one scalar or one-line list value.
 * @param {string} raw the text after `key:`
 * @returns {string | string[] | null}
 */
export function parseValue(raw) {
  const value = raw.trim();
  if (value === "null" || value === "~" || value === "") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => unquote(item.trim()));
  }
  return unquote(value);
}

/**
 * Removes one pair of surrounding quotes. Inner quotes stay as they are, so a title such as
 * `""Under the hood" page"` (not strict YAML) still reads as `"Under the hood" page`.
 * @param {string} value
 * @returns {string}
 */
export function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Reads the front matter block at the top of a Markdown file.
 * @param {string} text the whole file
 * @returns {Record<string, string | string[] | null>} the keys, or an empty object when there is no block
 */
export function parseFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  /** @type {Record<string, string | string[] | null>} */
  const data = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (match) data[match[1]] = parseValue(match[2]);
  }
  return data;
}

const START = "<!-- adr-index:start -->";
const END = "<!-- adr-index:end -->";
const ADR_FILE = /^(\d{4})-[a-z0-9-]+\.md$/;

/**
 * Builds one table row from an ADR's front matter.
 * @param {string} file the file name, for example `0004-nestjs-major-version-and-module-system.md`
 * @param {Record<string, string | string[] | null>} meta the parsed front matter
 * @returns {string}
 */
export function row(file, meta) {
  for (const key of ["id", "title", "status"]) {
    if (!meta[key]) throw new Error(`${file}: front matter has no "${key}"`);
  }
  const status = meta.superseded_by ? `superseded by ${meta.superseded_by}` : meta.status;
  const decisions = Array.isArray(meta.decisions) ? meta.decisions.join(", ") : "";
  const cell = (/** @type {unknown} */ value) => String(value).replace(/\|/g, "\\|");
  return `| ${cell(meta.id)} | ${cell(meta.title)} | ${cell(status)} | ${cell(decisions)} | [${file}](${file}) |`;
}

/**
 * Builds the whole table, sorted by file number.
 * @param {{ file: string, meta: Record<string, string | string[] | null> }[]} adrs
 * @returns {string}
 */
export function table(adrs) {
  const header = ["| ADR | Title | Status | Decisions | File |", "|---|---|---|---|---|"];
  const sorted = [...adrs].sort((a, b) => a.file.localeCompare(b.file));
  return [...header, ...sorted.map(({ file, meta }) => row(file, meta))].join("\n");
}

/**
 * Replaces the text between the two markers.
 * @param {string} readme the current README
 * @param {string} body the new table
 * @returns {string}
 */
export function replaceBetweenMarkers(readme, body) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md needs the markers ${START} and ${END}, in that order`);
  }
  return `${readme.slice(0, start + START.length)}\n${body}\n${readme.slice(end)}`;
}

function main() {
  const adrDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "adr");
  const readmePath = join(adrDir, "README.md");
  const adrs = readdirSync(adrDir)
    .filter((file) => ADR_FILE.test(file) && !file.startsWith("0000-"))
    .map((file) => ({ file, meta: parseFrontMatter(readFileSync(join(adrDir, file), "utf8")) }));

  const current = readFileSync(readmePath, "utf8");
  const next = replaceBetweenMarkers(current, table(adrs));

  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error("docs/adr/README.md is stale: run pnpm adr:index and commit the result.");
      process.exit(1);
    }
    console.log(`docs/adr/README.md is up to date (${adrs.length} ADRs).`);
    return;
  }
  if (next === current) {
    console.log(`docs/adr/README.md unchanged (${adrs.length} ADRs).`);
    return;
  }
  writeFileSync(readmePath, next);
  console.log(`docs/adr/README.md rewritten (${adrs.length} ADRs).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
