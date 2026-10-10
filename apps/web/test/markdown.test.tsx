import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isExternalHref } from "../src/markdown/components";
import { Markdown } from "../src/markdown/markdown";

/** Renders a body the way a page does and returns the HTML React sends. */
function render(source: string): string {
  return renderToStaticMarkup(<Markdown source={source} />);
}

describe("Markdown (ADR-011 safe pipeline)", () => {
  it("renders headings, emphasis and lists with the fixed components", () => {
    const html = render("## Problem\n\nSome **bold** and *soft* text.\n\n- one\n- two");
    expect(html).toContain('<h2 class="');
    expect(html).toContain(">Problem</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>soft</em>");
    expect(html).toMatch(/<ul class="[^"]*">\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  });

  it("turns a level-1 heading into a level 2: the page title is the only h1", () => {
    const html = render("# Title");
    expect(html).not.toContain("<h1");
    expect(html).toContain(">Title</h2>");
  });

  it("drops a script tag and its content", () => {
    const html = render('Before\n\n<script>alert("x")</script>\n\nAfter');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("drops an element with an onerror handler", () => {
    const html = render('Look: <img src="x" onerror="alert(1)"> here');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
  });

  it("drops a raw HTML block, keeping none of its tags or attributes", () => {
    const html = render(
      '<div style="color:red" onclick="steal()"><iframe src="https://evil.example"></iframe></div>\n\nText',
    );
    expect(html).not.toMatch(/<div|<iframe|style=|onclick/);
    expect(html).toContain("Text");
  });

  it.each([
    ["javascript:", "[click](javascript:alert(1))"],
    ["javascript: in mixed case", "[click](JaVaScRiPt:alert(1))"],
    ["data:", "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
  ])("turns a %s link into plain text", (_, source) => {
    const html = render(source);
    expect(html).not.toMatch(/javascript:|data:/i);
    expect(html).not.toContain("<a");
    expect(html).toMatch(/<p class="[^"]*">click<\/p>/);
  });

  it("marks an external link noopener noreferrer and leaves a site link alone", () => {
    const html = render("[out](https://example.com/a) and [in](/en/experience)");
    expect(html).toContain('<a href="https://example.com/a" rel="noopener noreferrer"');
    expect(html).toMatch(/<a href="\/en\/experience" class="[^"]*">in<\/a>/);
  });

  it("marks a protocol-relative link to another host noopener noreferrer", () => {
    const html = render("[out](//evil.example/a)");
    expect(html).toContain('<a href="//evil.example/a" rel="noopener noreferrer"');
  });

  it("never writes a style attribute, even for an aligned table", () => {
    const html = render("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("align=");
  });

  it("renders a GFM table", () => {
    const html = render("| Stack | Why |\n|---|---|\n| NestJS | modules |");
    expect(html).toMatch(/<table class="[^"]*"><thead><tr><th class="[^"]*">Stack<\/th>/);
    expect(html).toMatch(/<tbody><tr><td class="[^"]*">NestJS<\/td>/);
  });

  it("maps the callout directive to its note component", () => {
    const html = render(":::callout\nRead this **first**.\n:::");
    expect(html).toMatch(
      /<div role="note" class="[^"]*"><p class="[^"]*">Read this <strong>first<\/strong>\.<\/p><\/div>/,
    );
  });

  it("maps the figure directive to a figure with alt text and caption", () => {
    const html = render('::figure[The relay loop]{src="/media/relay.png" caption="Outbox relay"}');
    expect(html).toContain('<figure class="my-8"><img src="/media/relay.png" alt="The relay loop"');
    expect(html).toContain(">Outbox relay</figcaption></figure>");
  });

  it.each([
    ["another host", '::figure[x]{src="https://evil.example/a.png"}'],
    ["a protocol-relative URL", '::figure[x]{src="//evil.example/a.png"}'],
    ["a javascript: URL", '::figure[x]{src="javascript:alert(1)"}'],
    ["no source", "::figure[x]"],
  ])("renders nothing for a figure with %s", (_, source) => {
    expect(render(source)).toBe("");
  });

  it("renders an unknown directive as nothing, its content included", () => {
    expect(render(":::embed\n<script>x</script> hidden\n:::")).toBe("");
    expect(render('::video{src="/a.mp4"}')).toBe("");
  });

  it("keeps colons in prose that the directive syntax would read as text directives", () => {
    const html = render("Meet at 10:30, key:value.");
    expect(html).toContain("Meet at 10:30, key:value.");
  });

  it("drops footnotes, whose generated labels would be English on every locale", () => {
    const html = render("A claim.[^1]\n\n[^1]: The source.");
    expect(html).not.toMatch(/footnote|<sup|<section/i);
    expect(html).toContain("A claim.");
  });

  it("keeps escaped text as text", () => {
    expect(render("5 &lt; 6 and `<b>`")).toContain("5 &lt; 6 and <code");
  });
});

describe("isExternalHref", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com/x", true],
    ["https://jadero.dev/en", false],
    ["/en/projects", false],
    ["projects", false],
    // Both look relative, but the browser reads them as "another host".
    ["//evil.example/a", true],
    ["/\\evil.example/a", true],
    ["//jadero.dev/en", false],
    ["mailto:hi@example.com", false],
    ["#section", false],
  ])("%s is external: %s", (href, expected) => {
    expect(isExternalHref(href)).toBe(expected);
  });
});
