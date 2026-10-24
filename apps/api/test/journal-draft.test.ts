import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  excerptOf,
  OWNER_CHECK_MARKER,
  parseJournalDraft,
  slugFromTitle,
  withoutTitleHeading,
} from "../src/journal/journal-draft.js";

// WP-39 step 4 (D3): a journal draft file becomes one import command or a one-line refusal.

/** A draft file: front matter fields over defaults, then the body. */
function draft(
  fields: Record<string, string> = {},
  body = "# A title\n\nFirst paragraph.\n",
): string {
  const front = {
    wp: "41",
    title: '"A title"',
    status: "draft",
    date: "2026-10-24",
    locale: "en",
    ...fields,
  };
  const lines = Object.entries(front).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

describe("parseJournalDraft", () => {
  it("builds the import command: title heading dropped, slug from the title, excerpt, no tags", () => {
    const result = parseJournalDraft(
      draft({}, "# A title\n\nFirst `code` paragraph,\nwrapped.\n\n## Section\n\nMore.\n"),
    );
    expect(result).toEqual({
      ok: true,
      label: "wp-41 en",
      frontMatter: { wp: 41, title: "A title", status: "draft", date: "2026-10-24", locale: "en" },
      command: {
        wp: 41,
        locale: "en",
        document: {
          slug: "a-title",
          title: "A title",
          excerpt: "First code paragraph, wrapped.",
          body: "First `code` paragraph,\nwrapped.\n\n## Section\n\nMore.",
          tags: [],
        },
      },
    });
  });

  it("imports approved drafts too, and takes the locale from the front matter", () => {
    const result = parseJournalDraft(draft({ status: "approved", locale: "es" }));
    expect(result.ok && result.command.locale).toBe("es");
  });

  it("refuses a draft that still holds an owner check marker, naming WP and locale", () => {
    const result = parseJournalDraft(draft({}, `# A title\n\nI think so. ${OWNER_CHECK_MARKER}\n`));
    expect(result).toEqual({
      ok: false,
      label: "wp-41 en",
      reason: `holds an ${OWNER_CHECK_MARKER} marker; review it first`,
    });
  });

  it("refuses an em dash in the title or the body, without quoting the text", () => {
    const reason = "holds an em dash; use a comma, colon or new sentence";
    const inTitle = parseJournalDraft(draft({ title: `"A title ${EM_DASH} secret words"` }));
    const inBody = parseJournalDraft(draft({}, `# A title\n\nFirst ${EM_DASH} secret words.\n`));

    for (const result of [inTitle, inBody]) {
      expect(result).toEqual({ ok: false, label: "wp-41 en", reason });
      expect(JSON.stringify(result)).not.toContain("secret words");
    }
    expect(
      parseJournalDraft(draft({}, "# A title\n\nA hyphen - and an en dash \u2013 pass.\n")).ok,
    ).toBe(true);
  });

  it("names the field of invalid front matter, never the value", () => {
    const result = parseJournalDraft(draft({ wp: "zero", status: "final", locale: "fr" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.label).toBeUndefined();
    expect(result.reason).toMatch(/^front matter wp: .*; status: .*; locale: /);
    expect(result.reason).not.toMatch(/zero|final|fr\b/);
  });

  it("refuses a missing date or an invalid one", () => {
    const result = parseJournalDraft(draft({ date: "2026-13-01" }));
    expect(!result.ok && result.reason).toMatch(/^front matter date: /);
  });

  it("refuses a file without front matter, or with broken YAML", () => {
    expect(parseJournalDraft("# Just a body\n")).toEqual({
      ok: false,
      label: undefined,
      reason: "no front matter between --- lines at the top",
    });
    expect(parseJournalDraft("---\nwp: [41\n---\nbody\n")).toMatchObject({
      reason: "front matter is not valid YAML",
    });
    expect(parseJournalDraft("---\n- 1\n---\nbody\n")).toMatchObject({
      reason: expect.stringMatching(/^front matter front matter: /),
    });
  });

  it("refuses an empty body and a title with no letter or digit", () => {
    expect(parseJournalDraft(draft({}, "# A title\n"))).toMatchObject({
      reason: "the body is empty",
    });
    expect(parseJournalDraft(draft({ title: '"¿?"' }, "Text.\n"))).toMatchObject({
      reason: "the title gives no slug (no letters or digits)",
    });
  });
});

describe("withoutTitleHeading", () => {
  it("drops the first H1 only when it equals the title", () => {
    expect(withoutTitleHeading("\n# Title\n\nText", "Title")).toBe("Text");
    expect(withoutTitleHeading("# Other\n\nText", "Title")).toBe("# Other\n\nText");
    expect(withoutTitleHeading("## Title\n\nText", "Title")).toBe("## Title\n\nText");
  });
});

describe("slugFromTitle", () => {
  it("drops accents and punctuation, in every locale", () => {
    expect(slugFromTitle("El dominio de contenido: revisiones")).toBe(
      "el-dominio-de-contenido-revisiones",
    );
    expect(slugFromTitle("Größe über alles, ¿sí?")).toBe("grosse-uber-alles-si");
    expect(slugFromTitle("CI on someone else's machine")).toBe("ci-on-someone-else-s-machine");
  });

  it("cuts at a word boundary within the limit, or inside one long word", () => {
    expect(slugFromTitle("alpha beta gamma", 12)).toBe("alpha-beta");
    expect(slugFromTitle("supercalifragilistic", 5)).toBe("super");
    expect(slugFromTitle("!!!")).toBe("");
  });
});

describe("excerptOf", () => {
  it("takes the first prose paragraph as plain text", () => {
    const body = [
      "## Heading",
      "- a list",
      "> a quote",
      "Text with **bold**, *emphasis*, a [link](https://example.com) <!-- owner: x --> and `code`.",
      "Second paragraph.",
    ].join("\n\n");
    expect(excerptOf(body)).toBe("Text with bold, emphasis, a link and code.");
  });

  it("cuts a long paragraph at a word boundary with an ellipsis", () => {
    expect(excerptOf("one two three four, five", 20)).toBe("one two three four…");
    expect(excerptOf("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });

  it("removes a comment that removing another one put back together", () => {
    expect(excerptOf("Text <!<!---->-- x --> after")).toBe("Text after");
  });

  it("drops a stray angle bracket", () => {
    expect(excerptOf("Text <b>bold</b> and a < b")).toBe("Text bbold/b and a b");
  });

  it("is empty when there is no prose paragraph", () => {
    expect(excerptOf("## Only a heading")).toBe("");
  });
});
