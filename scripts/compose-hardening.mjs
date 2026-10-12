/**
 * Checks the hardened runtime Compose file (WP-7 step 5; ADR-049 restating ADR-048 "Images";
 * ADR-027 memory budget and port binding; docs/learning/wp-7.md D2, D4, D5). Every service of
 * `infra/compose/compose.images.yml` runs read-only, without capabilities, without new privileges,
 * with a size-capped `/tmp` and a memory limit, and publishes ports on 127.0.0.1 only. A
 * long-running service keeps its heap near 75% of its limit and starts only after its own migrate
 * step completed; a one-off migrate never restarts and has no healthcheck. A fitness function:
 * the rules hold by test, not by review, like dependency-cruiser for imports.
 *
 * Run by `scripts/compose-hardening.test.mjs` through `pnpm test:scripts`, so `pnpm verify`. No
 * dependencies, like the other scripts: `parseComposeYaml` reads the YAML subset Compose files here
 * use and throws on anything else, so a new construct fails loudly instead of being misread.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The Compose file that runs the production images, relative to the root. */
export const COMPOSE_IMAGES = "infra/compose/compose.images.yml";

/** The share of `mem_limit` that `--max-old-space-size` may take (ADR-027: about 75%). */
const HEAP_SHARE = { min: 0.6, max: 0.8 };

/**
 * Parses the YAML subset of the repository's Compose files: block maps and lists by indentation,
 * flow lists (`[a, "b"]`), quoted and plain scalars, `true` and `false`, comments, anchors
 * (`&name`), aliases (`*name`) and merge keys (`<<: *a` or `<<: [*a, *b]`, explicit keys win).
 * @param source the file's text.
 * @returns the document as plain objects, arrays and scalars.
 * @throws Error on block scalars, flow maps, tabs, list items that are maps or bad indentation.
 */
export function parseComposeYaml(source) {
  const lines = source
    .split("\n")
    .map((text, index) => ({ number: index + 1, text: stripComment(text).trimEnd() }))
    .filter((line) => line.text.trim() !== "")
    .map((line) => {
      if (/^\s*\t/.test(line.text)) fail(line, "tabs are not allowed for indentation");
      const indent = line.text.length - line.text.trimStart().length;
      return { ...line, indent, content: line.text.trim() };
    });
  const anchors = new Map();
  const state = { index: 0 };
  if (lines.length === 0) return {};
  const document = parseBlock(lines, state, lines[0].indent, anchors);
  if (state.index < lines.length) fail(lines[state.index], "unexpected indentation");
  return document;
}

/**
 * Checks a parsed Compose document against the hardening rules.
 * @param document the parsed file (`parseComposeYaml`).
 * @param path the file's path, for the messages.
 * @returns the problems found; empty when every service follows the rules.
 */
export function checkComposeHardening(document, path = COMPOSE_IMAGES) {
  const services = document?.services;
  if (!services || typeof services !== "object" || Object.keys(services).length === 0) {
    return [`${path}: no services`];
  }
  const problems = [];
  const migrateOf = new Map(
    Object.entries(services)
      .filter(([, service]) => isOneOff(service))
      .map(([name, service]) => [service.image, name]),
  );
  for (const [name, service] of Object.entries(services)) {
    const at = `${path}: ${name}`;
    if (service.read_only !== true) problems.push(`${at} must set read_only: true`);
    if (!asList(service.cap_drop).includes("ALL"))
      problems.push(`${at} must drop every capability (cap_drop: [ALL])`);
    if (
      !asList(service.security_opt).some((opt) => /^no-new-privileges(:true|=true)?$/.test(opt))
    ) {
      problems.push(`${at} must set security_opt no-new-privileges:true`);
    }
    if (!asList(service.tmpfs).some((mount) => /^\/tmp:(.*,)?size=\d+[kmg]?(,|$)/.test(mount))) {
      problems.push(`${at} must mount a size-capped tmpfs on /tmp`);
    }
    const limit = megabytes(service.mem_limit);
    if (limit === null) problems.push(`${at} must set mem_limit (ADR-027)`);
    for (const port of asList(service.ports)) {
      if (!String(port).startsWith("127.0.0.1:"))
        problems.push(`${at} publishes ${port}: bind it to 127.0.0.1 (ADR-027)`);
    }
    if (/-migrate$/.test(name) && !isOneOff(service)) {
      problems.push(`${at} is a one-off: set restart: "no" and disable its healthcheck`);
    }
    if (isOneOff(service)) continue;
    const heap = maxOldSpace(service.environment?.NODE_OPTIONS);
    if (
      limit !== null &&
      (heap === null || heap < limit * HEAP_SHARE.min || heap > limit * HEAP_SHARE.max)
    ) {
      problems.push(`${at} must set NODE_OPTIONS --max-old-space-size to about 75% of mem_limit`);
    }
    const migrate = migrateOf.get(service.image);
    if (migrate && service.depends_on?.[migrate]?.condition !== "service_completed_successfully") {
      problems.push(
        `${at} must depend on ${migrate} with condition: service_completed_successfully`,
      );
    }
  }
  return problems;
}

/**
 * Reads the repository's runtime Compose file and checks it.
 * @param root the repository root.
 * @returns the services checked and the problems found.
 */
export function checkRepository(root = REPO_ROOT) {
  const document = parseComposeYaml(readFileSync(join(root, COMPOSE_IMAGES), "utf8"));
  return {
    services: Object.keys(document.services ?? {}).sort(),
    problems: checkComposeHardening(document),
  };
}

/** A one-off process: never restarted and without a healthcheck (D5, WP-10 D2). */
function isOneOff(service) {
  return service.restart === "no" && service.healthcheck?.disable === true;
}

/** A Compose memory size (`300m`, `1g`, bytes) in megabytes, or null when missing or unreadable. */
function megabytes(value) {
  const match = /^(\d+)([bkmg]?)$/i.exec(String(value ?? ""));
  if (!match) return null;
  const scale = { "": 1 / 2 ** 20, b: 1 / 2 ** 20, k: 1 / 1024, m: 1, g: 1024 };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

/** The `--max-old-space-size` of a NODE_OPTIONS value, in megabytes, or null. */
function maxOldSpace(nodeOptions) {
  const match = /--max-old-space-size=(\d+)/.exec(String(nodeOptions ?? ""));
  return match ? Number(match[1]) : null;
}

function asList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function fail(line, message) {
  throw new Error(`line ${line.number}: ${message}: ${line.text.trim()}`);
}

/** Drops a comment: `#` at the start or after a space, outside quotes. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

/** Parses the block (map or list) whose lines start at `indent`. */
function parseBlock(lines, state, indent, anchors) {
  return lines[state.index].content.startsWith("- ") || lines[state.index].content === "-"
    ? parseList(lines, state, indent, anchors)
    : parseMap(lines, state, indent, anchors);
}

function parseList(lines, state, indent, anchors) {
  const list = [];
  while (state.index < lines.length && lines[state.index].indent === indent) {
    const line = lines[state.index];
    if (!line.content.startsWith("- ")) fail(line, "expected a list item");
    const item = line.content.slice(2).trim();
    if (/^[\w.<-]+:(\s|$)/.test(item)) fail(line, "list items that are maps are not supported");
    list.push(parseScalar(item, line, anchors));
    state.index++;
  }
  return list;
}

function parseMap(lines, state, indent, anchors) {
  const map = {};
  const merged = [];
  while (state.index < lines.length && lines[state.index].indent === indent) {
    const line = lines[state.index];
    const match = /^([\w.-]+|<<|"[^"]+"):(?:\s+(.*))?$/.exec(line.content);
    if (!match) fail(line, "expected `key: value`");
    const key = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
    let rest = match[2]?.trim() ?? "";
    state.index++;
    let anchor = null;
    const anchorMatch = /^&([\w-]+)\s*(.*)$/.exec(rest);
    if (anchorMatch) [, anchor, rest] = anchorMatch;
    let value;
    if (rest === "") {
      const next = lines[state.index];
      value = next && next.indent > indent ? parseBlock(lines, state, next.indent, anchors) : null;
    } else {
      value = parseScalar(rest, line, anchors);
    }
    if (anchor) anchors.set(anchor, value);
    if (key === "<<") {
      for (const source of Array.isArray(value) ? value : [value]) {
        if (!source || typeof source !== "object" || Array.isArray(source))
          fail(line, "a merge key needs maps");
        merged.push(source);
      }
    } else {
      if (Object.hasOwn(map, key)) fail(line, `duplicate key ${key}`);
      map[key] = value;
    }
  }
  // Merge semantics: explicit keys win; among merged maps, the first one listed wins.
  return Object.assign({}, ...[...merged].reverse(), map);
}

function parseScalar(text, line, anchors) {
  if (/^[|>{?]/.test(text))
    fail(line, "block scalars, flow maps and complex keys are not supported");
  if (text.startsWith("*")) {
    const name = text.slice(1);
    if (!anchors.has(name)) fail(line, `unknown alias *${name}`);
    return anchors.get(name);
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) fail(line, "a flow list must close on the same line");
    return splitFlow(text.slice(1, -1)).map((item) => parseScalar(item, line, anchors));
  }
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

/** Splits a flow list's inside on commas outside quotes. */
function splitFlow(inside) {
  const items = [];
  let quote = null;
  let current = "";
  for (const char of inside) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") items.push(current.trim());
  return items;
}
