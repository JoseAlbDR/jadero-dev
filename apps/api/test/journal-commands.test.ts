import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  describeFailure,
  importJournalFiles,
  type JournalOutput,
  parseJournalArgs,
  publishJournal,
  readJournalFiles,
} from "../src/journal/journal-commands.js";
import { OWNER_CHECK_MARKER } from "../src/journal/journal-draft.js";
import { CreateContentItem } from "../src/modules/content/application/use-cases/create-content-item.use-case.js";
import { ImportJournalPost } from "../src/modules/content/application/use-cases/import-journal-post.use-case.js";
import { PublishContentItem } from "../src/modules/content/application/use-cases/publish-content-item.use-case.js";
import { PublishJournalPost } from "../src/modules/content/application/use-cases/publish-journal-post.use-case.js";
import { SaveContentRevision } from "../src/modules/content/application/use-cases/save-content-revision.use-case.js";
import { contentPorts } from "./content-use-case.fakes.js";

// WP-39 step 4 (D3): the command-line adapter of the journal import and publish, on the real use
// cases over the in-memory unit of work. Every line names WP, locale and outcome, never a body.

/** Collects the lines a command prints. */
function recorder(): JournalOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (line) => lines.push(`info ${line}`),
    error: (line) => lines.push(`error ${line}`),
  };
}

function draftFile(
  name: string,
  wp: number,
  locale: string,
  extra = "",
): { name: string; text: string } {
  return {
    name,
    text: `---\nwp: ${wp}\ntitle: Journal ${wp}\nstatus: draft\ndate: 2026-10-24\nlocale: ${locale}\n---\n\n# Journal ${wp}\n\nSecret body text.${extra}\n`,
  };
}

let importPost: ImportJournalPost;
let publishPost: PublishJournalPost;

beforeEach(() => {
  const ports = contentPorts();
  importPost = new ImportJournalPost(
    ports.uow,
    new CreateContentItem(ports.uow, ports.ids),
    new SaveContentRevision(ports.uow, ports.ids, ports.clock),
  );
  publishPost = new PublishJournalPost(ports.uow, new PublishContentItem(ports.uow, ports.clock));
});

describe("parseJournalArgs", () => {
  it("defaults import to the drafts folder and resolves a given one from the caller's directory", () => {
    expect(parseJournalArgs(["import"], "/repo", "/repo/docs/journal")).toEqual({
      command: "import",
      dir: "/repo/docs/journal",
    });
    expect(parseJournalArgs(["import", "drafts"], "/repo", "/x")).toEqual({
      command: "import",
      dir: "/repo/drafts",
    });
  });

  it("parses publish with a WP and optional locales", () => {
    expect(parseJournalArgs(["publish", "12"], "/", "/")).toEqual({
      command: "publish",
      wp: 12,
      locales: [],
    });
    expect(parseJournalArgs(["publish", "12", "en", "es"], "/", "/")).toMatchObject({
      locales: ["en", "es"],
    });
  });

  it("refuses an unknown command, a bad WP, a bad locale or an extra argument", () => {
    for (const argv of [
      [],
      ["export"],
      ["publish"],
      ["publish", "0"],
      ["publish", "12", "fr"],
      ["import", "a", "b"],
    ]) {
      expect(() => parseJournalArgs(argv, "/", "/"), argv.join(" ")).toThrow(ZodError);
    }
  });
});

describe("readJournalFiles", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "journal-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads every Markdown draft but the README, in WP order", async () => {
    for (const name of ["README.md", "wp-10.md", "wp-5.md", "wp-5.es.md", "notes.txt"]) {
      await writeFile(join(dir, name), name);
    }
    const files = await readJournalFiles(dir);
    expect(files.map((f) => f.name)).toEqual(["wp-5.es.md", "wp-5.md", "wp-10.md"]);
    expect(files[2]?.text).toBe("wp-10.md");
  });
});

describe("importJournalFiles", () => {
  it("prints one line per file, refuses marked or invalid drafts, and counts them", async () => {
    const output = recorder();
    const files = [
      draftFile("wp-41.md", 41, "en"),
      draftFile("wp-41.es.md", 41, "es"),
      draftFile("wp-42.md", 42, "en", ` ${OWNER_CHECK_MARKER}`),
      { name: "wp-43.md", text: "no front matter" },
    ];
    expect(await importJournalFiles(files, importPost, output)).toBe(2);
    expect(await importJournalFiles(files.slice(0, 1), importPost, output)).toBe(0);
    expect(output.lines).toEqual([
      "info wp-41 en: created",
      "info wp-41 es: created",
      `error wp-42 en: refused: holds an ${OWNER_CHECK_MARKER} marker; review it first`,
      "error wp-43.md: refused: no front matter between --- lines at the top",
      "info wp-41 en: unchanged",
    ]);
    expect(output.lines.join("\n")).not.toContain("Secret body text");
  });

  it("reports a use case failure on its line and goes on", async () => {
    const output = recorder();
    const failing = {
      execute: async () => {
        throw new Error("boom");
      },
    };
    expect(await importJournalFiles([draftFile("wp-41.md", 41, "en")], failing, output)).toBe(1);
    expect(output.lines).toEqual(["error wp-41 en: failed: Error: boom"]);
  });
});

describe("publishJournal", () => {
  it("prints the domain refusal in one line, then what went live and the de warning", async () => {
    const output = recorder();
    await importJournalFiles([draftFile("wp-41.md", 41, "en")], importPost, output);
    expect(await publishJournal(41, [], publishPost, output)).toBe(false);
    await importJournalFiles([draftFile("wp-41.es.md", 41, "es")], importPost, output);
    expect(await publishJournal(41, ["es", "en"], publishPost, output)).toBe(true);
    expect(await publishJournal(41, ["en"], publishPost, output)).toBe(true);
    expect(await publishJournal(41, [], publishPost, output)).toBe(true);
    expect(output.lines.filter((line) => !line.includes(": created"))).toEqual([
      expect.stringMatching(
        /^error wp-41: not published: RequiredLocalesMissing: Item .+ cannot be published without es\.$/,
      ),
      "info wp-41: published es, en",
      "info wp-41: warning: de is not published",
      "info wp-41: nothing to publish",
      "info wp-41: already live en",
      "info wp-41: warning: de is not published",
      "info wp-41: nothing to publish",
    ]);
  });
});

describe("describeFailure", () => {
  it("prints a query error's code only, a validation error's paths, and other errors by name", () => {
    const query = new DrizzleQueryError(
      "insert ... secret",
      ["secret"],
      Object.assign(new Error("x"), { code: "23505" }),
    );
    expect(describeFailure(query)).toBe("query failed (23505)");
    expect(describeFailure(new DrizzleQueryError("q", [], new Error("x")))).toBe(
      "query failed (no code)",
    );
    const zod = new ZodError([{ code: "custom", path: ["wp"], message: "bad", input: "secret" }]);
    expect(describeFailure(zod)).toBe("invalid input: wp: bad");
    expect(describeFailure("text")).toBe("unknown error");
  });
});
