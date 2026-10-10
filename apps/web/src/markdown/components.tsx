import type { ComponentProps, ReactNode } from "react";
import { z } from "zod";
import { SITE_URL } from "@/config/site";

/**
 * True when a link leaves the site: resolved against the site origin, the way the browser resolves
 * it, it is an http(s) URL on another origin. That catches `//host` and `/\host`, which look
 * relative but leave the site. Relative paths, same-site URLs and `mailto:` are not external.
 * @param href the sanitized `href` of a Markdown link.
 */
export function isExternalHref(href: string): boolean {
  try {
    const url = new URL(href, SITE_URL);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && url.origin !== SITE_URL.origin
    );
  } catch {
    return false;
  }
}

/**
 * A link in a content body. An external one gets `rel="noopener noreferrer"`: the other site gets
 * no handle on this window and no `Referer` with the page URL. `rehype-sanitize` has already
 * removed any `href` that is not `http`, `https` or `mailto`; a link left without one is plain
 * text, so it does not look like a link that goes nowhere.
 * @param props the anchor props produced from the Markdown link.
 */
export function MarkdownLink({ href, title, children }: ComponentProps<"a">) {
  if (!href) return <>{children}</>;
  const external = isExternalHref(href);
  return (
    <a
      href={href}
      title={title}
      rel={external ? "noopener noreferrer" : undefined}
      className="text-signal underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  );
}

/**
 * The `:::callout` directive (ADR-011): a highlighted note inside a body. A `role="note"` block,
 * not an `aside`, which would be a landmark nested in the article.
 * @param props.children the Markdown inside the directive.
 */
export function Callout({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <div
      role="note"
      className="my-6 rounded-xl border border-border border-l-4 border-l-signal bg-surface/60 px-5 py-1"
    >
      {children}
    </div>
  );
}

/** The props of the figure tag, checked again here: this component is the boundary to the DOM. */
const figureProps = z.object({
  src: z.string().regex(/^\/(?![/\\])[^\s\\]*$/),
  alt: z.string().default(""),
  caption: z.string().optional(),
});

/**
 * The `::figure[alt]{src=... caption=...}` directive (ADR-011): an image from the site's own media
 * with an optional caption. Renders nothing when the source is not a path on the site.
 * @param props the `src`, `alt` and `caption` the remark plugin put on the figure tag.
 */
export function Figure(props: Readonly<Record<string, unknown>>) {
  const parsed = figureProps.safeParse(props);
  if (!parsed.success) return null;
  const { src, alt, caption } = parsed.data;
  return (
    <figure className="my-8">
      {/* A plain img: the media are served by nginx, outside the Next image optimizer. */}
      <img src={src} alt={alt} loading="lazy" className="h-auto max-w-full rounded-xl" />
      {caption && <figcaption className="mt-2 text-muted-foreground text-sm">{caption}</figcaption>}
    </figure>
  );
}
