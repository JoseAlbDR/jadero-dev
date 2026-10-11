import type { Root } from "hast";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeSanitize from "rehype-sanitize";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { Callout, Figure, MarkdownLink } from "./components";
import { remarkSiteRules } from "./remark-site-rules";
import { CALLOUT_TAG, FIGURE_TAG, markdownSchema } from "./schema";

/*
 * The safe Markdown pipeline of content bodies (ADR-011). Bodies are Markdown, never MDX, because
 * MDX compiles to JavaScript and a body stored in the database must never run as code. The text
 * goes through remark (parse, GitHub tables and lists, directives, the site's rules), becomes HTML
 * syntax without any raw HTML (`remark-rehype` drops it), is cut down to an allowlist
 * (`rehype-sanitize`) and is turned into React elements, never an HTML string: there is no
 * `dangerouslySetInnerHTML` anywhere on this path.
 */

/** The processor, built once: parse and transform only, the output is a hast tree. */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkSiteRules)
  .use(remarkRehype)
  .use(rehypeSanitize, markdownSchema)
  .freeze();

/**
 * Runs a Markdown body through the pipeline, up to the sanitized HTML syntax tree.
 * @param source the raw Markdown of a body, as the content API returns it.
 * @returns the sanitized hast tree.
 */
export function markdownToHast(source: string): Root {
  return processor.runSync(processor.parse(source));
}

/**
 * The fixed components of the allowed tags: classes from the design tokens (a `style` attribute
 * would be blocked by the CSP) and the directive tags mapped to their React components.
 */
const components = {
  a: MarkdownLink,
  h2: (props) => (
    <h2 className="mt-10 mb-4 font-semibold text-2xl tracking-tight first:mt-0" {...props} />
  ),
  h3: (props) => <h3 className="mt-8 mb-3 font-semibold text-xl tracking-tight" {...props} />,
  h4: (props) => <h4 className="mt-6 mb-2 font-semibold text-lg" {...props} />,
  h5: (props) => <h5 className="mt-6 mb-2 font-semibold" {...props} />,
  h6: (props) => <h6 className="mt-6 mb-2 font-semibold" {...props} />,
  p: (props) => <p className="my-4 text-pretty leading-relaxed" {...props} />,
  ul: (props) => <ul className="my-4 list-disc space-y-1 pl-6" {...props} />,
  ol: (props) => <ol className="my-4 list-decimal space-y-1 pl-6" {...props} />,
  blockquote: (props) => (
    <blockquote className="my-6 border-signal border-l-2 pl-4 text-muted-foreground" {...props} />
  ),
  code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm" {...props} />,
  // Wrapped instead of scrolled: a scrolling block would need to be focusable (WCAG 2.1.1).
  pre: (props) => (
    <pre
      className="my-6 whitespace-pre-wrap break-words rounded-xl bg-term p-4 font-mono text-sm text-term-foreground [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  hr: (props) => <hr className="my-8 border-border" {...props} />,
  table: (props) => <table className="my-6 w-full border-collapse text-left text-sm" {...props} />,
  th: (props) => <th className="border-border border-b px-2 py-1.5 font-semibold" {...props} />,
  td: (props) => <td className="border-border border-b px-2 py-1.5" {...props} />,
  [CALLOUT_TAG]: Callout,
  [FIGURE_TAG]: Figure,
} as Partial<Components>;

type MarkdownProps = Readonly<{ source: string }>;

/**
 * A content body rendered on the server through the safe Markdown pipeline (ADR-011).
 * @param props.source the raw Markdown of the body.
 * @returns the body as React elements.
 */
export function Markdown({ source }: MarkdownProps): ReactNode {
  return toJsxRuntime(markdownToHast(source), {
    Fragment,
    jsx,
    jsxs,
    components,
    // Table alignment would become a `style` attribute, which the CSP blocks; it is dropped.
    tableCellAlignToStyle: false,
  });
}
