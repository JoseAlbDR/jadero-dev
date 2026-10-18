/**
 * Checks the nginx edge in `infra/nginx/` (WP-8 step 5; ADR-047's edge part, ADR-050 restating
 * ADR-027's host nginx; D6 and the 2026-10-18 amendment in docs/learning/wp-8.md). A fitness
 * function like `compose-hardening.mjs`: the rules hold by test, not by review. `nginx -t` in CI
 * (the `nginx` job of ci.yml) proves the files load; this proves they say what the ADR asks:
 *
 * - `nginx.conf`: `server_tokens off`, the TLS policy (TLS 1.2 and 1.3, session tickets off, a
 *   shared session cache) and the rate limit zone answering 429, all in `http`.
 * - No directive declared twice at the same level, includes expanded (only the ones nginx allows
 *   to repeat, such as `add_header` or `listen`, may).
 * - Privacy of the access logs: no `log_format` writes the client address, the request line or
 *   the query string (`$remote_addr`, `$request`, `$request_uri`, `$args` and friends), and every
 *   `access_log` names one of the repo's formats instead of falling back to `combined`.
 * - Error logs (ADR-052): every server of a site sets its own `error_log`, and every `error_log` of
 *   a site writes a `.log` file in `/var/log/nginx/jadero/`, the folder `infra/logrotate/jadero-nginx`
 *   rotates; that rule names the folder's glob and no other path, rotates `daily` and keeps at
 *   most 3 files.
 * - Every HTTPS server includes the security headers snippet and runs HTTP/2; no location sets
 *   add_header, proxy_set_header or proxy_hide_header (one that did would drop every inherited
 *   value); no Access-Control-* header anywhere, and the proxy snippet hides the upstream copies.
 * - Allowlist routing: every HTTPS server ends `/api/` (or `/`) in a 404, and every API location
 *   that proxies carries the rate limit and the 64k body limit; upstreams only on 127.0.0.1.
 * - Every plain HTTP server of a host redirects to https with a 301, from a location (so certbot's
 *   challenge location still wins).
 * - No IPv4 address other than 127.0.0.1 in any file of `infra/nginx/` (a public repo).
 *
 * `selectLocation` picks the location nginx would use for a path, so the tests can check where a
 * public path goes (Umami's two first-party paths on the site host, ADR-051).
 *
 * Run by `scripts/nginx-hardening.test.mjs` through `pnpm test:scripts`, so `pnpm verify`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The edge's folder, relative to the root. */
export const NGINX_DIR = "infra/nginx";

/** The security headers snippet every HTTPS server includes. */
export const HEADERS_SNIPPET = "snippets/jadero-security-headers.conf";

/** The proxy snippet. */
export const PROXY_SNIPPET = "snippets/jadero-proxy.conf";

/** The jadero sites' error log folder (ADR-052). */
export const ERROR_LOG_DIR = "/var/log/nginx/jadero/";

/** The logrotate rule for that folder, relative to the root. */
export const LOGROTATE_FILE = "infra/logrotate/jadero-nginx";

/** The glob the rule must rotate. */
const ERROR_LOG_GLOB = `${ERROR_LOG_DIR}*.log`;

/** The most rotated files the rule may keep: three days of client addresses (ADR-052). */
const MAX_ROTATE = 3;

/** A site's error log path: a `.log` file directly in the folder, so the glob matches it. */
const ERROR_LOG_PATH = /^\/var\/log\/nginx\/jadero\/[^/]+\.log$/;

/** Directives nginx allows more than once at one level. */
const REPEATABLE = new Set([
  "include",
  "listen",
  "add_header",
  "proxy_set_header",
  "proxy_hide_header",
  "location",
  "server",
  "map",
  "log_format",
  "limit_req_zone",
  "error_page",
]);

/** Blocks whose children are table entries, not directives. */
const TABLE_BLOCKS = new Set(["map", "types", "geo", "split_clients"]);

/**
 * Variables no log format may write: the client address in clear, the request line and the
 * query string, forwarded addresses, cookies, credentials and the referer (which carries other
 * sites' query strings). AGENTS.md section 7.
 */
const BANNED_LOG_VARIABLE =
  /\$\{?(remote_addr|binary_remote_addr|realip_remote_addr|request|request_uri|request_body|args|query_string|is_args|http_x_forwarded_for|proxy_add_x_forwarded_for|http_x_real_ip|http_cookie|http_authorization|http_referer|(?:arg|cookie)_[A-Za-z0-9_]+)(?![A-Za-z0-9_])/;

/** The upstream headers the proxy snippet must hide (ADR-047). */
const HIDDEN_UPSTREAM_HEADERS = [
  "X-Powered-By",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Access-Control-Allow-Origin",
  "Access-Control-Allow-Credentials",
  "Access-Control-Allow-Headers",
  "Access-Control-Allow-Methods",
  "Access-Control-Expose-Headers",
  "Access-Control-Max-Age",
];

/** The headers the security snippet must add, each with `always`. */
const EDGE_HEADERS = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
];

/** Directives a location must not set: each one drops every value inherited from the server. */
const LOCATION_BANS = ["add_header", "proxy_set_header", "proxy_hide_header"];

/** The only upstream address: services publish on the loopback interface (ADR-027). */
const UPSTREAM = /^http:\/\/127\.0\.0\.1:\d+(\/.*)?$/;

/** A dotted IPv4 address. */
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;

/**
 * Parses an nginx configuration file into directives.
 * @param source the file's text.
 * @param file the file's name, for error messages.
 * @returns the top-level directives: `{ name, args, line, block? }`, where `block` holds the
 *   directives inside braces.
 * @throws Error on an unbalanced brace or a directive without its `;`.
 */
export function parseNginx(source, file = "nginx.conf") {
  const tokens = tokenize(source, file);
  let index = 0;
  /** Reads directives until a closing brace (inside a block) or the end of the file. */
  const readBlock = (nested) => {
    const directives = [];
    let words = [];
    let line = 0;
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token.type === "word") {
        if (words.length === 0) line = token.line;
        words.push(token.value);
      } else if (token.type === ";") {
        if (words.length === 0) throw new Error(`${file}:${token.line}: empty directive`);
        directives.push({ name: words[0], args: words.slice(1), line });
        words = [];
      } else if (token.type === "{") {
        if (words.length === 0) throw new Error(`${file}:${token.line}: block without a name`);
        directives.push({ name: words[0], args: words.slice(1), line, block: readBlock(true) });
        words = [];
      } else if (token.type === "}") {
        if (!nested) throw new Error(`${file}:${token.line}: unexpected }`);
        if (words.length > 0) throw new Error(`${file}:${token.line}: missing ; before }`);
        return directives;
      }
    }
    if (nested) throw new Error(`${file}: missing }`);
    if (words.length > 0) throw new Error(`${file}:${line}: missing ; at the end`);
    return directives;
  };
  return readBlock(false);
}

/**
 * Replaces each `include` of a repo snippet with the snippet's directives, recursively; includes
 * of files outside the repo (mime.types, sites-enabled/*) stay as they are.
 * @param directives parsed directives (`parseNginx`).
 * @param snippets the snippets by include path (`snippets/<name>.conf`).
 * @returns the directives with the snippets expanded; each expanded one carries `from`.
 */
export function expandIncludes(directives, snippets) {
  const out = [];
  for (const directive of directives) {
    const target = directive.name === "include" ? snippetKey(directive.args[0]) : null;
    if (target && snippets[target]) {
      out.push({ ...directive, expanded: true });
      for (const inner of expandIncludes(parseNginx(snippets[target], target), snippets)) {
        out.push({ ...inner, from: inner.from ?? target });
      }
    } else if (directive.block) {
      out.push({ ...directive, block: expandIncludes(directive.block, snippets) });
    } else {
      out.push(directive);
    }
  }
  return out;
}

/**
 * Checks the edge's files against the rules in this file's header.
 * @param files the texts: `main` (nginx.conf), `sites` and `snippets` keyed by their path under
 *   infra/nginx (`sites/new.jadero.dev.conf`, `snippets/jadero-proxy.conf`).
 * @returns the problems found; empty when every rule holds.
 */
export function checkNginx({ main, sites, snippets }) {
  const problems = [];
  const parse = (source, file) => {
    try {
      return expandIncludes(parseNginx(source, file), snippets);
    } catch (error) {
      problems.push(error.message);
      return [];
    }
  };
  const conf = parse(main, "nginx.conf");
  const http = conf.find((d) => d.name === "http")?.block ?? [];
  if (http.length === 0) problems.push("nginx.conf: no http block");
  problems.push(...mainProblems(http));

  const formats = new Set();
  const parsedSites = Object.entries(sites).map(([file, source]) => [file, parse(source, file)]);
  const parsedSnippets = Object.entries(snippets).map(([file, source]) => [
    file,
    parse(source, file),
  ]);
  const everything = [["nginx.conf", conf], ...parsedSites, ...parsedSnippets];
  for (const [file, directives] of everything) {
    for (const d of walk(directives)) {
      if (d.name === "log_format") {
        formats.add(d.args[0]);
        const format = d.args.slice(1).join(" ");
        const banned = BANNED_LOG_VARIABLE.exec(format);
        if (banned) {
          problems.push(
            `${where(file, d)}: log_format ${d.args[0]} writes $${banned[1]}: log $jadero_client_net and $uri instead`,
          );
        }
      }
      if (d.name === "add_header" && /^access-control-/i.test(d.args[0] ?? "")) {
        problems.push(`${where(file, d)}: ${d.args[0]} is set: no CORS on any host (ADR-047)`);
      }
    }
    problems.push(...duplicateProblems(directives, file));
  }
  for (const [file, directives] of everything) {
    for (const d of walk(directives)) {
      if (d.name !== "access_log" || d.args[0] === "off") continue;
      if (!formats.has(d.args[1])) {
        problems.push(
          `${where(file, d)}: access_log ${d.args[0]} must name a repo log format (the default combined writes the address and query string)`,
        );
      }
    }
  }
  for (const [file, directives] of parsedSites) {
    problems.push(...siteProblems(directives, file));
    for (const d of walk(directives)) {
      if (d.name === "error_log" && !ERROR_LOG_PATH.test(d.args[0] ?? "")) {
        problems.push(
          `${where(file, d)}: error_log ${d.args[0]} must be a .log file in ${ERROR_LOG_DIR}, which keeps three days (ADR-052)`,
        );
      }
    }
  }
  problems.push(...snippetProblems(snippets, parse));
  return problems;
}

/**
 * Finds IPv4 addresses other than 127.0.0.1 in the edge's files: the repo is public, and the
 * upstreams live on the loopback interface.
 * @param files file texts keyed by path.
 * @returns the problems found.
 */
export function ipProblems(files) {
  const problems = [];
  for (const [file, text] of Object.entries(files)) {
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(IPV4)) {
        if (match[0] !== "127.0.0.1" && match.slice(1).every((part) => Number(part) <= 255)) {
          problems.push(`${file}:${index + 1}: address ${match[0]}: only 127.0.0.1 may appear`);
        }
      }
    });
  }
  return problems;
}

/**
 * Picks the location nginx uses for a URI inside one server, in nginx's order: an exact `=` match;
 * else the longest prefix, final when it carries `^~`; else the first regex (`~`, `~*`) that
 * matches, in file order; else that longest prefix. Nested locations are not followed.
 * @param server a parsed `server` directive.
 * @param uri a normalized path without its query string, as nginx matches it.
 * @returns the location directive, or undefined when none matches.
 */
export function selectLocation(server, uri) {
  const locations = (server.block ?? []).filter((d) => d.name === "location");
  const exact = locations.find((l) => l.args[0] === "=" && l.args[1] === uri);
  if (exact) return exact;
  let longest;
  for (const location of locations) {
    const [modifier, path] = location.args.length === 2 ? location.args : [null, location.args[0]];
    if (modifier !== null && modifier !== "^~") continue;
    if (uri.startsWith(path) && (!longest || path.length > longest.path.length)) {
      longest = { location, path, modifier };
    }
  }
  if (longest?.modifier === "^~") return longest.location;
  const regex = locations.find(
    (l) =>
      (l.args[0] === "~" || l.args[0] === "~*") &&
      new RegExp(l.args[1], l.args[0] === "~*" ? "i" : "").test(uri),
  );
  return regex ?? longest?.location;
}

/**
 * Reads one site file of `infra/nginx/` and returns its HTTPS server, the repo snippets expanded.
 * @param site the site's path under infra/nginx (`sites/new.jadero.dev.conf`).
 * @param root the repository root.
 * @returns the parsed `server` directive that listens on 443 with ssl, or undefined.
 */
export function readHttpsServer(site, root = REPO_ROOT) {
  const dir = join(root, NGINX_DIR);
  const snippets = Object.fromEntries(
    readdirSync(join(dir, "snippets"))
      .filter((name) => name.endsWith(".conf"))
      .map((name) => [`snippets/${name}`, readFileSync(join(dir, "snippets", name), "utf8")]),
  );
  const directives = expandIncludes(
    parseNginx(readFileSync(join(dir, site), "utf8"), site),
    snippets,
  );
  return directives.find(
    (d) =>
      d.name === "server" &&
      (d.block ?? []).some(
        (l) => l.name === "listen" && /(^|:)443$/.test(l.args[0]) && l.args.includes("ssl"),
      ),
  );
}

/**
 * Checks the logrotate rule of the sites' error logs (ADR-052): it rotates the folder's glob and no
 * path outside the folder (Ubuntu's rule owns those), daily, keeping at most three files.
 * @param text the rule's text.
 * @param file the rule's path, for error messages.
 * @returns the problems found; empty when every rule holds.
 */
export function logrotateProblems(text, file = LOGROTATE_FILE) {
  const problems = [];
  const lines = text.split("\n").map((line) => line.replace(/#.*/, "").trim());
  const open = lines.findIndex((line) => line.endsWith("{"));
  if (open === -1) return [`${file}: no rule block`];
  const paths = lines
    .slice(0, open + 1)
    .join(" ")
    .replace("{", " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!paths.includes(ERROR_LOG_GLOB)) problems.push(`${file}: must rotate ${ERROR_LOG_GLOB}`);
  for (const path of paths.filter((p) => !p.startsWith(ERROR_LOG_DIR))) {
    problems.push(`${file}: ${path} is outside ${ERROR_LOG_DIR} (Ubuntu's rule rotates it)`);
  }
  const directives = [];
  let script = false;
  for (const line of lines.slice(open + 1)) {
    if (line === "}" && !script) break;
    if (/^(pre|post|first|last)rotate$|^preremove$/.test(line)) script = true;
    else if (line === "endscript") script = false;
    else if (!script && line) directives.push(line.split(/\s+/));
  }
  const frequencies = directives.filter(([name]) =>
    ["hourly", "daily", "weekly", "monthly", "yearly"].includes(name),
  );
  if (frequencies.length !== 1 || frequencies[0][0] !== "daily") {
    problems.push(`${file}: must rotate daily, and set no other frequency`);
  }
  const rotate = directives.filter(([name]) => name === "rotate");
  const count = Number(rotate.at(-1)?.[1]);
  if (rotate.length !== 1 || !Number.isInteger(count) || count < 0 || count > MAX_ROTATE) {
    problems.push(`${file}: must set rotate once, at most ${MAX_ROTATE} (ADR-052)`);
  }
  return problems;
}

/**
 * Reads `infra/nginx/` and checks it.
 * @param root the repository root.
 * @returns the site files checked and the problems found.
 */
export function checkNginxRepository(root = REPO_ROOT) {
  const dir = join(root, NGINX_DIR);
  const read = (sub) =>
    Object.fromEntries(
      readdirSync(join(dir, sub))
        .filter((name) => name.endsWith(".conf"))
        .sort()
        .map((name) => [`${sub}/${name}`, readFileSync(join(dir, sub, name), "utf8")]),
    );
  const main = readFileSync(join(dir, "nginx.conf"), "utf8");
  const sites = read("sites");
  const snippets = read("snippets");
  const problems = checkNginx({ main, sites, snippets });
  problems.push(...ipProblems(allFiles(dir, NGINX_DIR)));
  problems.push(...logrotateProblems(readFileSync(join(root, LOGROTATE_FILE), "utf8")));
  return { sites: Object.keys(sites), problems };
}

/** The rules of nginx.conf's `http` block. */
function mainProblems(http) {
  const problems = [];
  const value = (name) => http.find((d) => d.name === name)?.args.join(" ");
  if (value("server_tokens") !== "off")
    problems.push("nginx.conf: http must set server_tokens off");
  if (value("ssl_protocols") !== "TLSv1.2 TLSv1.3") {
    problems.push("nginx.conf: http must set ssl_protocols TLSv1.2 TLSv1.3");
  }
  if (value("ssl_session_tickets") !== "off") {
    problems.push("nginx.conf: http must set ssl_session_tickets off");
  }
  if (!/^shared:/.test(value("ssl_session_cache") ?? "")) {
    problems.push("nginx.conf: http must set a shared ssl_session_cache");
  }
  if (!http.some((d) => d.name === "limit_req_zone" && d.args.includes("zone=jadero_api:10m"))) {
    problems.push("nginx.conf: http must define the limit_req_zone jadero_api");
  }
  if (value("limit_req_status") !== "429") {
    problems.push("nginx.conf: http must set limit_req_status 429");
  }
  if (!http.some((d) => d.name === "access_log")) {
    problems.push("nginx.conf: http must set access_log with a repo format");
  }
  return problems;
}

/** The rules of one site file: its HTTPS and HTTP servers. */
function siteProblems(directives, file) {
  const problems = [];
  for (const server of directives.filter((d) => d.name === "server")) {
    const body = server.block ?? [];
    const at = `${file}:${server.line}`;
    const listens = body.filter((d) => d.name === "listen");
    const https = listens.some((d) => /(^|:)443$/.test(d.args[0]) && d.args.includes("ssl"));
    const isDefault = listens.some((d) => d.args.includes("default_server"));
    if (!body.some((d) => d.name === "error_log")) {
      problems.push(`${at}: a server must set its own error_log in ${ERROR_LOG_DIR} (ADR-052)`);
    }
    for (const d of body) {
      if (["ssl_protocols", "ssl_ciphers", "server_tokens"].includes(d.name)) {
        problems.push(`${file}:${d.line}: ${d.name} belongs to nginx.conf's http block only`);
      }
      if (d.name === "proxy_pass") problems.push(...proxyPassProblems(d, file));
    }
    const locations = body.filter((d) => d.name === "location");
    for (const location of locations) problems.push(...locationProblems(location, file));
    if (https && !isDefault) {
      if (!includes(body, HEADERS_SNIPPET)) {
        problems.push(`${at}: an HTTPS server must include ${HEADERS_SNIPPET} at the server level`);
      }
      if (!body.some((d) => d.name === "http2" && d.args[0] === "on")) {
        problems.push(`${at}: an HTTPS server must set http2 on`);
      }
      const denies = locations.some(
        (l) => l.args.length === 1 && ["/api/", "/"].includes(l.args[0]) && returns404(l),
      );
      if (!denies) {
        problems.push(`${at}: /api/ (or /) must end in a deny-by-default return 404`);
      }
    } else if (https && isDefault) {
      if (!body.some((d) => d.name === "ssl_reject_handshake" && d.args[0] === "on")) {
        problems.push(`${at}: the default HTTPS server must set ssl_reject_handshake on`);
      }
    } else if (!isDefault) {
      const name = body.find((d) => d.name === "server_name")?.args[0];
      const root = locations.find((l) => l.args.length === 1 && l.args[0] === "/");
      const ret = root?.block?.find((d) => d.name === "return");
      if (ret?.args[0] !== "301" || ret.args[1] !== `https://${name}$request_uri`) {
        problems.push(`${at}: location / must return 301 https://${name}$request_uri`);
      }
    }
  }
  return problems;
}

/** The rules of one location: no header directives, limits on proxied API paths. */
function locationProblems(location, file) {
  const problems = [];
  const at = `${file}:${location.line}: location ${location.args.join(" ")}`;
  const body = location.block ?? [];
  for (const d of walk(body)) {
    if (LOCATION_BANS.includes(d.name)) {
      problems.push(`${at} sets ${d.name}, which drops every value inherited from the server`);
    }
    if (d.name === "proxy_pass") problems.push(...proxyPassProblems(d, file));
  }
  const path = location.args.at(-1) ?? "";
  if (path.includes("/api") && body.some((d) => d.name === "proxy_pass")) {
    if (!body.some((d) => d.name === "limit_req" && d.args.includes("zone=jadero_api"))) {
      problems.push(`${at} proxies an API without limit_req zone=jadero_api`);
    }
    if (!body.some((d) => d.name === "client_max_body_size" && d.args[0] === "64k")) {
      problems.push(`${at} proxies an API without client_max_body_size 64k`);
    }
  }
  return problems;
}

/** The rules of the shared snippets. */
function snippetProblems(snippets, parse) {
  const problems = [];
  const headers = snippets[HEADERS_SNIPPET];
  if (headers === undefined) {
    problems.push(`${HEADERS_SNIPPET}: missing`);
  } else {
    const added = parse(headers, HEADERS_SNIPPET).filter((d) => d.name === "add_header");
    for (const name of EDGE_HEADERS) {
      const header = added.find((d) => d.args[0]?.toLowerCase() === name.toLowerCase());
      if (!header) problems.push(`${HEADERS_SNIPPET}: must add ${name}`);
      else if (header.args.at(-1) !== "always") {
        problems.push(`${HEADERS_SNIPPET}: ${name} must be added with always`);
      }
    }
  }
  const proxy = snippets[PROXY_SNIPPET];
  if (proxy === undefined) {
    problems.push(`${PROXY_SNIPPET}: missing`);
  } else {
    const hidden = parse(proxy, PROXY_SNIPPET)
      .filter((d) => d.name === "proxy_hide_header")
      .map((d) => d.args[0]?.toLowerCase());
    for (const name of HIDDEN_UPSTREAM_HEADERS) {
      if (!hidden.includes(name.toLowerCase())) {
        problems.push(`${PROXY_SNIPPET}: must hide the upstream's ${name}`);
      }
    }
  }
  return problems;
}

/** A proxy_pass must point at a service on 127.0.0.1. */
function proxyPassProblems(directive, file) {
  return UPSTREAM.test(directive.args[0] ?? "")
    ? []
    : [`${file}:${directive.line}: proxy_pass ${directive.args[0]} must target http://127.0.0.1`];
}

/** Directives declared twice at one level (includes already expanded). */
function duplicateProblems(directives, file) {
  const problems = [];
  const seen = new Map();
  for (const d of directives) {
    if (d.name === "include" && d.expanded) continue;
    if (!REPEATABLE.has(d.name)) {
      const first = seen.get(d.name);
      if (first !== undefined) {
        problems.push(
          `${where(file, d)}: ${d.name} is declared twice at the same level (first at ${first})`,
        );
      } else {
        seen.set(d.name, where(file, d));
      }
    }
    if (d.block && !TABLE_BLOCKS.has(d.name)) problems.push(...duplicateProblems(d.block, file));
  }
  return problems;
}

/** Where a directive is: its file and line, through the snippet it came from when included. */
function where(file, directive) {
  return directive.from
    ? `${file} via ${directive.from}:${directive.line}`
    : `${file}:${directive.line}`;
}

/** Whether the level includes the given snippet. */
function includes(directives, snippet) {
  return directives.some((d) => d.name === "include" && snippetKey(d.args[0]) === snippet);
}

/** Whether a location answers 404 with a return. */
function returns404(location) {
  return (location.block ?? []).some((d) => d.name === "return" && d.args[0] === "404");
}

/** The repo snippet an include path names (`snippets/x.conf` or `/etc/nginx/snippets/x.conf`). */
function snippetKey(path) {
  const match = /^(?:\/etc\/nginx\/)?(snippets\/[^/]+\.conf)$/.exec(path ?? "");
  return match ? match[1] : null;
}

/** Every directive, depth first, table block entries excluded. */
function* walk(directives) {
  for (const d of directives) {
    yield d;
    if (d.block && !TABLE_BLOCKS.has(d.name)) yield* walk(d.block);
  }
}

/** Every file under a folder, keyed by its path from the root. */
function allFiles(dir, prefix) {
  const files = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, allFiles(path, `${prefix}/${entry.name}`));
    else files[`${prefix}/${entry.name}`] = readFileSync(path, "utf8");
  }
  return files;
}

/**
 * Splits nginx configuration text into words, quoted strings, braces and semicolons; drops
 * comments. Quotes are removed from quoted words, as nginx does.
 */
function tokenize(source, file) {
  const tokens = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "#") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "{" || c === "}" || c === ";") {
      tokens.push({ type: c, line });
      i++;
    } else if (c === '"' || c === "'") {
      const start = line;
      let value = "";
      i++;
      while (i < source.length && source[i] !== c) {
        // nginx unescapes only the quote and the backslash; `\d` in a regex stays `\d`.
        if (source[i] === "\\" && ['"', "'", "\\"].includes(source[i + 1])) {
          value += source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === "\n") line++;
        value += source[i++];
      }
      if (i >= source.length) throw new Error(`${file}:${start}: unterminated quote`);
      i++;
      tokens.push({ type: "word", value, line: start });
    } else {
      let value = "";
      while (i < source.length && !/[\s;{}]/.test(source[i])) value += source[i++];
      tokens.push({ type: "word", value, line });
    }
  }
  return tokens;
}
