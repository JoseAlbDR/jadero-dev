import { fileURLToPath } from "node:url";
import { migrationFolderProblems } from "@jadero/platform-nest";
import { describe, expect, it } from "vitest";

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("api migrations (drizzle/)", () => {
  it("keep idx sequential and timestamps strictly growing, every entry with its SQL file", () => {
    // Drizzle applies only entries newer than the last applied one: an edited or reordered entry
    // would be skipped silently in every database that already ran it.
    expect(migrationFolderProblems(folder)).toEqual([]);
  });
});
