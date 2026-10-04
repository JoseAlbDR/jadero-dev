#!/usr/bin/env node
/**
 * Creates the next ADR from docs/adr/0000-template.md.
 *
 * Usage: pnpm adr:new "Title of the decision"
 * Writes docs/adr/NNNN-title-of-the-decision.md with `id`, `title` and today's `date` filled in
 * and `status: proposed`, then prints the path. Run `pnpm adr:index` after editing it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Turns a title into the file name part: lowercase ASCII letters, digits and single hyphens.
 * @param {string} title
 * @returns {string}
 */
export function kebab(title) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Finds the next free ADR number from the file names in the folder.
 * @param {string[]} files
 * @returns {number}
 */
export function nextNumber(files) {
  const numbers = files
    .map((file) => /^(\d{4})-/.exec(file)?.[1])
    .filter(Boolean)
    .map(Number);
  return Math.max(0, ...numbers) + 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log('Usage: pnpm adr:new "Title of the decision"');
    return;
  }
  const title = args.join(" ").trim();
  if (!title) {
    console.error('Usage: pnpm adr:new "Title of the decision"');
    process.exit(1);
  }
  const slug = kebab(title);
  if (!slug) {
    console.error("The title needs at least one letter or digit.");
    process.exit(1);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const adrDir = join(root, "docs", "adr");
  const number = nextNumber(readdirSync(adrDir));
  const id = `ADR-${String(number).padStart(3, "0")}`;
  const target = join(adrDir, `${String(number).padStart(4, "0")}-${slug}.md`);
  if (existsSync(target)) {
    console.error(`${relative(root, target)} already exists.`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const quoted = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const text = readFileSync(join(adrDir, "0000-template.md"), "utf8")
    .replace(/^id: .*$/m, `id: ${id}`)
    .replace(/^title: .*$/m, `title: "${quoted}"`)
    .replace(/^date: .*$/m, `date: ${today}`)
    .replace(/^status: .*$/m, "status: proposed")
    .replace(/^# ADR-NNN: .*$/m, `# ${id}: ${title}`);

  writeFileSync(target, text, { flag: "wx" });
  console.log(relative(root, target));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
