import type { Options as SanitizeSchema } from "rehype-sanitize";

/** Tag of the `:::callout` container directive after `remarkSiteRules` (ADR-011). */
export const CALLOUT_TAG = "jadero-callout";

/** Tag of the `::figure{src=... caption=...}` leaf directive after `remarkSiteRules` (ADR-011). */
export const FIGURE_TAG = "jadero-figure";

/**
 * The allowlist of `rehype-sanitize` for content Markdown (ADR-011), written out instead of
 * extending GitHub's default schema, so every tag and attribute a body can produce is listed here.
 * Anything else is removed: an unknown element is unwrapped (its text stays), `script` and `style`
 * go with their content, and `id`/`name` values get a `user-content-` prefix so a body cannot
 * clobber a page global. Links keep `href` only for `http`, `https` and `mailto`, so a
 * `javascript:` or `data:` link loses its target. No `style`, `class` or event attribute survives:
 * the CSP blocks a `style` attribute anyway (ADR-047), and classes come from the fixed components.
 * Images are not on the list: a picture enters a body only through the `figure` directive, whose
 * `src` is checked to be a path on the site.
 */
export const markdownSchema: SanitizeSchema = {
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
    CALLOUT_TAG,
    FIGURE_TAG,
  ],
  attributes: {
    a: ["href", "title"],
    ol: ["start"],
    [FIGURE_TAG]: ["src", "alt", "caption"],
  },
  protocols: { href: ["http", "https", "mailto"] },
  required: {},
  strip: ["script", "style"],
  ancestors: {
    li: ["ol", "ul"],
    tbody: ["table"],
    td: ["table"],
    th: ["table"],
    thead: ["table"],
    tr: ["table"],
  },
  clobberPrefix: "user-content-",
  clobber: ["ariaDescribedBy", "ariaLabelledBy", "id", "name"],
  allowComments: false,
  allowDoctypes: false,
};
