// Runs with the Node test runner (`node --test`), so the ADR scripts stay dependency-free (WP-1 decision K).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFrontMatter, replaceBetweenMarkers, row, table } from "./index.mjs";
import { kebab, nextNumber } from "./new.mjs";

const adr = `---
id: ADR-004
title: "NestJS major version and module system"
status: superseded
decisions: [D-4]
supersedes: []
superseded_by: ADR-042
---

# ADR-004: body text: with colons
`;

describe("parseFrontMatter", () => {
  it("reads strings, lists, empty lists and null", () => {
    assert.deepEqual(parseFrontMatter(adr), {
      id: "ADR-004",
      title: "NestJS major version and module system",
      status: "superseded",
      decisions: ["D-4"],
      supersedes: [],
      superseded_by: "ADR-042",
    });
  });

  it("keeps inner quotes and unescapes escaped ones", () => {
    assert.equal(
      parseFrontMatter('---\ntitle: ""Under the hood" page"\n---\n').title,
      '"Under the hood" page',
    );
    assert.equal(parseFrontMatter('---\ntitle: "Use \\"quotes\\""\n---\n').title, 'Use "quotes"');
  });

  it("returns an empty object without a front matter block", () => {
    assert.deepEqual(parseFrontMatter("# Just a heading\n"), {});
  });
});

describe("row and table", () => {
  it("shows the superseding ADR in the status column", () => {
    assert.equal(
      row("0004-x.md", parseFrontMatter(adr)),
      "| ADR-004 | NestJS major version and module system | superseded by ADR-042 | D-4 | [0004-x.md](0004-x.md) |",
    );
  });

  it("sorts by file name and fails on a missing title", () => {
    const meta = { id: "ADR-001", title: "A", status: "accepted", decisions: ["D-1", "D-2"] };
    const lines = table([
      { file: "0002-b.md", meta: { ...meta, id: "ADR-002" } },
      { file: "0001-a.md", meta },
    ]).split("\n");
    assert.match(lines[2], /^\| ADR-001 \| A \| accepted \| D-1, D-2 \|/);
    assert.throws(() => row("0003-c.md", { id: "ADR-003", status: "accepted" }), /no "title"/);
  });
});

describe("replaceBetweenMarkers", () => {
  it("changes only the text between the markers", () => {
    const readme = "intro\n<!-- adr-index:start -->\nold\n<!-- adr-index:end -->\noutro\n";
    assert.equal(
      replaceBetweenMarkers(readme, "new"),
      "intro\n<!-- adr-index:start -->\nnew\n<!-- adr-index:end -->\noutro\n",
    );
    assert.throws(() => replaceBetweenMarkers("no markers", "new"), /markers/);
  });
});

describe("new.mjs helpers", () => {
  it("builds a kebab file name and the next number", () => {
    assert.equal(kebab('Use "quotes" & Ümlauts, here!'), "use-quotes-umlauts-here");
    assert.equal(nextNumber(["0000-template.md", "0042-x.md", "README.md"]), 43);
  });
});
