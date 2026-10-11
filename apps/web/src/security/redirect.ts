/**
 * Origins outside the site a redirect may send a visitor to (ADR-047). Empty: no route redirects
 * off-site today. The cutover 301s of a later WP add an entry here only when one must leave the host.
 */
export const REDIRECT_ALLOWLIST: readonly string[] = [];

/** Encoded layers peeled off a target before the checks; more than this is refused outright. */
const MAX_DECODE_ROUNDS = 3;

/**
 * Peels percent-encoding off a path, layer by layer, the way a careless proxy or framework would
 * when it decodes twice, and drops the tabs and newlines a browser strips from a URL.
 * @param path the path part of a same-origin target.
 * @returns every decoded form of the path, or `undefined` when it is malformed or nested too deep.
 */
function decodedForms(path: string): string[] | undefined {
  const forms = [path];
  let current = path;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (next === current) {
      return forms.map((form) => form.replace(/[\t\n\r]/g, ""));
    }
    forms.push(next);
    current = next;
  }
  return undefined;
}

/**
 * Open-redirect guard (ADR-047): checks a redirect target that derives from request input. A target
 * on the site itself comes back as a relative path (`/de/projekte?x=1`), which the caller resolves
 * on its own origin; an absolute URL comes back only when its origin is on the allowlist.
 * Everything else is refused: another host, `//host` and `/\host` (browsers read both as
 * "another host"), `javascript:` and other schemes, a relative path without a leading `/`, and any
 * of these hidden behind percent-encoding, tabs or newlines.
 * @param target the redirect target as built from the request (relative or absolute).
 * @param origin the site's own origin as seen by this request, for example `https://jadero.dev`.
 * @param allowlist origins outside the site that are allowed, as `https://host[:port]`.
 * @returns the safe `Location` value, or `undefined` when the target must not be followed.
 */
export function safeRedirectTarget(
  target: string,
  origin: string | URL,
  allowlist: readonly string[] = REDIRECT_ALLOWLIST,
): string | undefined {
  const own = new URL(origin).origin;
  let url: URL;
  try {
    // The WHATWG parser reads the target exactly as the browser will (backslashes, tabs, case).
    url = new URL(target, own);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }

  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(target.trim());
  if (url.origin !== own) {
    return isAbsolute && allowlist.includes(url.origin) ? url.href : undefined;
  }
  // Same origin: only an absolute URL or a path that starts with exactly one `/`.
  if (!isAbsolute && !/^\/(?![/\\])/.test(target)) {
    return undefined;
  }

  const forms = decodedForms(url.pathname);
  if (!forms || forms.some((form) => /^[/\\]{2}|^\/?[a-z][a-z\d+.-]*:/i.test(form))) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
