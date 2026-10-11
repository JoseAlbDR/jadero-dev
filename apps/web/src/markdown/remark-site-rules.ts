import type { Nodes, Root, Text } from "mdast";
// Loads the directive node types into mdast's (`remark-directive` augments them).
import type {} from "remark-directive";
import { SKIP, visit } from "unist-util-visit";
import { z } from "zod";
import { CALLOUT_TAG, FIGURE_TAG } from "./schema";

type ContainerDirective = Extract<Nodes, { type: "containerDirective" }>;
type LeafDirective = Extract<Nodes, { type: "leafDirective" }>;
type TextDirective = Extract<Nodes, { type: "textDirective" }>;

/**
 * A `figure` source: a path on the site itself (`/media/diagram.png`), never another host. The CSP
 * only loads images from the site (ADR-047), and a path starting with `//` or `/\` would be read by
 * the browser as another host.
 */
const sitePath = z
  .string()
  .max(500)
  .regex(/^\/(?![/\\])[^\s\\]*$/);

/** The attributes of `::figure[alt]{src=... caption=...}`; the label in brackets is the alt text. */
const figureAttributes = z.object({ src: sitePath, caption: z.string().max(500).optional() });

/**
 * The plain text of a node's children (a directive label), for the `alt` of a figure.
 * @param node an mdast node.
 * @returns the concatenated text values.
 */
function plainText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node ? node.children.map((child) => plainText(child)).join("") : "";
}

/**
 * Maps a known container or leaf directive to its fixed component tag, or returns `false` for an
 * unknown or malformed one, which the caller removes.
 */
function mapDirective(node: ContainerDirective | LeafDirective): boolean {
  if (node.type === "containerDirective" && node.name === "callout") {
    node.data = { hName: CALLOUT_TAG, hProperties: {} };
    return true;
  }
  if (node.type === "leafDirective" && node.name === "figure") {
    const attributes = figureAttributes.safeParse(node.attributes ?? {});
    if (!attributes.success) return false;
    const { src, caption } = attributes.data;
    node.data = {
      hName: FIGURE_TAG,
      hProperties: { src, alt: plainText(node).trim(), ...(caption ? { caption } : {}) },
    };
    node.children = [];
    return true;
  }
  return false;
}

/**
 * A text directive back as the text it was written as. No text directive is known, and
 * `remark-directive` also reads ordinary prose such as `10:30` or `key:value` as one (`:30`,
 * `:value`); dropping those would eat words from a sentence.
 */
function textDirectiveAsText(node: TextDirective): Text {
  const label = node.children.length > 0 ? `[${plainText(node)}]` : "";
  return { type: "text", value: `:${node.name}${label}` };
}

/**
 * The remark plugin of the site's content Markdown (ADR-011), run after `remark-directive` and
 * before `remark-rehype`:
 * - `:::callout` and `::figure[alt]{src=... caption=...}` become the fixed tags that `Markdown`
 *   maps to React components; a figure whose `src` is not a path on the site is removed.
 * - Any other container or leaf directive is removed with its content: it renders as nothing.
 * - A text directive is turned back into its text (see `textDirectiveAsText`).
 * - A level-1 heading becomes level 2: the page title is the only `h1`.
 * - Footnotes are removed: their generated section would carry English labels on every locale.
 * Raw HTML needs no step here: `remark-rehype` drops it, and `rehype-sanitize` runs after.
 */
export function remarkSiteRules() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (parent === undefined || index === undefined) return;
      switch (node.type) {
        case "containerDirective":
        case "leafDirective":
          if (mapDirective(node)) return;
          parent.children.splice(index, 1);
          return [SKIP, index];
        case "textDirective":
          parent.children[index] = textDirectiveAsText(node);
          return SKIP;
        case "footnoteReference":
        case "footnoteDefinition":
          parent.children.splice(index, 1);
          return [SKIP, index];
        case "heading":
          if (node.depth === 1) node.depth = 2;
          return;
        default:
          return;
      }
    });
  };
}
