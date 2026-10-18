// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkNginx,
  checkNginxRepository,
  expandIncludes,
  ipProblems,
  parseNginx,
} from "./nginx-hardening.mjs";

const MAIN = `
user www-data;
include /etc/nginx/modules-enabled/*.conf;
events { worker_connections 768; }
http {
  server_tokens off;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;
  ssl_session_tickets off;
  map $remote_addr $jadero_client_net {
    "~^(\\d+\\.\\d+\\.\\d+)\\.\\d+$" $1.0/24;
    default -;
  }
  log_format jadero '$time_iso8601 $jadero_client_net $host "$request_method $uri" $status';
  access_log /var/log/nginx/access.log jadero;
  limit_req_zone $binary_remote_addr zone=jadero_api:10m rate=10r/s;
  limit_req_status 429;
  include /etc/nginx/sites-enabled/*;
}
`;

const HEADERS = `
add_header Strict-Transport-Security "max-age=300" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=()" always;
`;

const PROXY = `
proxy_set_header Host $host;
${[
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
]
  .map((name) => `proxy_hide_header ${name};`)
  .join("\n")}
`;

const LIMITS = `
limit_req zone=jadero_api burst=20 nodelay;
client_max_body_size 64k;
`;

/** A site with one HTTP redirect server and one HTTPS server; `extra` goes in the HTTPS server. */
const site = (extra = "", api = "include snippets/jadero-api-limits.conf;") => `
server {
  listen 80;
  server_name a.example;
  location / { return 301 https://a.example$request_uri; }
}
server {
  listen 443 ssl;
  http2 on;
  server_name a.example;
  access_log /var/log/nginx/a.access.log jadero;
  include snippets/jadero-security-headers.conf;
  include snippets/jadero-proxy.conf;
  location / { proxy_pass http://127.0.0.1:3120; }
  location /api/v1/ {
    ${api}
    proxy_pass http://127.0.0.1:3121/v1/;
  }
  location /api/ { return 404; }${extra}
}
`;

/** Checks a variation of the valid files. */
const check = ({ main = MAIN, sites = { "sites/a.conf": site() }, snippets = {} } = {}) =>
  checkNginx({
    main,
    sites,
    snippets: {
      "snippets/jadero-security-headers.conf": HEADERS,
      "snippets/jadero-proxy.conf": PROXY,
      "snippets/jadero-api-limits.conf": LIMITS,
      ...snippets,
    },
  });

describe("the repository's infra/nginx", () => {
  it("follows every edge rule", () => {
    const { sites, problems } = checkNginxRepository();
    assert.deepEqual(sites, [
      "sites/00-default.conf",
      "sites/admin.jadero.dev.conf",
      "sites/new.jadero.dev.conf",
      "sites/stats.jadero.dev.conf",
      "sites/status.jadero.dev.conf",
    ]);
    assert.deepEqual(problems, []);
  });
});

describe("parseNginx", () => {
  it("reads directives, blocks, quotes and comments", () => {
    const parsed = parseNginx("a 1; # note\nb \"x y\" { c 'z;'; }\n");
    assert.deepEqual(parsed, [
      { name: "a", args: ["1"], line: 1 },
      { name: "b", args: ["x y"], line: 2, block: [{ name: "c", args: ["z;"], line: 2 }] },
    ]);
  });

  it("keeps a regex backslash and unescapes a quote", () => {
    assert.deepEqual(parseNginx('a "~^\\d+\\"x";')[0].args, ['~^\\d+"x']);
  });

  it("fails on a missing semicolon or brace", () => {
    assert.throws(() => parseNginx("a 1"), /missing ; at the end/);
    assert.throws(() => parseNginx("a { b 1; "), /missing }/);
    assert.throws(() => parseNginx("}"), /unexpected }/);
  });

  it("expands a repo snippet in place and leaves other includes alone", () => {
    const expanded = expandIncludes(
      parseNginx("include snippets/x.conf; include /etc/nginx/mime.types;"),
      { "snippets/x.conf": "y 1;" },
    );
    assert.deepEqual(
      expanded.map((d) => d.name),
      ["include", "y", "include"],
    );
    assert.equal(expanded[1].from, "snippets/x.conf");
  });
});

describe("checkNginx", () => {
  it("accepts the valid files", () => {
    assert.deepEqual(check(), []);
  });

  it("fails when server_tokens is not off", () => {
    assert.deepEqual(check({ main: MAIN.replace("server_tokens off", "server_tokens build") }), [
      "nginx.conf: http must set server_tokens off",
    ]);
  });

  it("fails when a directive is declared twice at one level", () => {
    assert.deepEqual(
      check({ main: MAIN.replace("server_tokens off;", "server_tokens off; gzip on; gzip on;") }),
      ["nginx.conf:6: gzip is declared twice at the same level (first at nginx.conf:6)"],
    );
  });

  it("fails when a snippet included twice repeats a directive", () => {
    const sites = { "sites/a.conf": site("\n  include snippets/jadero-proxy.conf;") };
    assert.deepEqual(check({ sites, snippets: { "snippets/jadero-proxy.conf": `${PROXY}x 1;` } }), [
      "sites/a.conf via snippets/jadero-proxy.conf:14: x is declared twice at the same level (first at sites/a.conf via snippets/jadero-proxy.conf:14)",
    ]);
  });

  it("fails when a log format writes the address, the request line or the query string", () => {
    for (const variable of ["$remote_addr", "$request", "$request_uri", "$args", "$arg_token"]) {
      const main = MAIN.replace("$uri", `$uri ${variable}`);
      assert.deepEqual(check({ main }), [
        `nginx.conf:14: log_format jadero writes ${variable}: log $jadero_client_net and $uri instead`,
      ]);
    }
  });

  it("accepts $request_method and $request_time, which carry no query string", () => {
    assert.deepEqual(check({ main: MAIN.replace("$status", "$status $request_time") }), []);
  });

  it("fails when an access_log falls back to the combined format", () => {
    const sites = { "sites/a.conf": site().replace("a.access.log jadero", "a.access.log") };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:11: access_log /var/log/nginx/a.access.log must name a repo log format (the default combined writes the address and query string)",
    ]);
  });

  it("fails when an HTTPS server does not include the headers snippet", () => {
    const sites = {
      "sites/a.conf": site().replace("include snippets/jadero-security-headers.conf;", ""),
    };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:7: an HTTPS server must include snippets/jadero-security-headers.conf at the server level",
    ]);
  });

  it("fails when a location sets its own headers (they would drop the inherited ones)", () => {
    const sites = { "sites/a.conf": site('\n  location /x { add_header X-A "b" always; }') };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:20: location /x sets add_header, which drops every value inherited from the server",
    ]);
  });

  it("fails on any Access-Control-* header", () => {
    const sites = {
      "sites/a.conf": site('\n  add_header Access-Control-Allow-Origin "*" always;'),
    };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:20: Access-Control-Allow-Origin is set: no CORS on any host (ADR-047)",
    ]);
  });

  it("fails when /api/ does not end in a 404", () => {
    const sites = { "sites/a.conf": site().replace("location /api/ { return 404; }", "") };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:7: /api/ (or /) must end in a deny-by-default return 404",
    ]);
  });

  it("fails when an API location proxies without the rate and body limits", () => {
    assert.deepEqual(check({ sites: { "sites/a.conf": site("", "") } }), [
      "sites/a.conf:15: location /api/v1/ proxies an API without limit_req zone=jadero_api",
      "sites/a.conf:15: location /api/v1/ proxies an API without client_max_body_size 64k",
    ]);
  });

  it("fails when an upstream is not on 127.0.0.1", () => {
    const sites = { "sites/a.conf": site().replace("127.0.0.1:3120", "web:3000") };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:14: proxy_pass http://web:3000 must target http://127.0.0.1",
    ]);
  });

  it("fails when the HTTP server does not redirect to https from a location", () => {
    const sites = {
      "sites/a.conf": site().replace(
        "location / { return 301 https://a.example$request_uri; }",
        "return 301 https://a.example$request_uri;",
      ),
    };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:2: location / must return 301 https://a.example$request_uri",
    ]);
  });

  it("fails when an HTTPS server sets its own TLS protocols", () => {
    const sites = { "sites/a.conf": site("\n  ssl_protocols TLSv1 TLSv1.2;") };
    assert.deepEqual(check({ sites }), [
      "sites/a.conf:20: ssl_protocols belongs to nginx.conf's http block only",
    ]);
  });

  it("fails when the proxy snippet lets an upstream's CORS header through", () => {
    const snippets = {
      "snippets/jadero-proxy.conf": PROXY.replace("proxy_hide_header Access-Control-Max-Age;", ""),
    };
    assert.deepEqual(check({ snippets }), [
      "snippets/jadero-proxy.conf: must hide the upstream's Access-Control-Max-Age",
    ]);
  });

  it("fails when an edge header is added without always", () => {
    const snippets = {
      "snippets/jadero-security-headers.conf": HEADERS.replace('"nosniff" always', '"nosniff"'),
    };
    assert.deepEqual(check({ snippets }), [
      "snippets/jadero-security-headers.conf: X-Content-Type-Options must be added with always",
    ]);
  });

  it("requires the default HTTPS server to refuse the handshake", () => {
    const sites = {
      "sites/00-default.conf": "server { listen 443 ssl default_server; server_name _; }",
    };
    assert.deepEqual(check({ sites }), [
      "sites/00-default.conf:1: the default HTTPS server must set ssl_reject_handshake on",
    ]);
  });
});

describe("ipProblems", () => {
  it("allows 127.0.0.1 and versions, and fails on any other address", () => {
    assert.deepEqual(
      ipProblems({
        "a.conf": "proxy_pass http://127.0.0.1:3120;\n# nginx 1.28.3\nallow 172.30.1.5;",
      }),
      ["a.conf:3: address 172.30.1.5: only 127.0.0.1 may appear"],
    );
  });
});
