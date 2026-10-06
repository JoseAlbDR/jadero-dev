import { fileURLToPath } from "node:url";
import { migrationFolderProblems } from "@jadero/platform-nest";
import { describe, expect, it } from "vitest";
import { pendingSchemaChanges } from "./setup/pending-schema-changes.js";

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("api migrations (drizzle/)", () => {
  it("keep idx sequential and timestamps strictly growing, every entry with its SQL file", () => {
    // Drizzle applies only entries newer than the last applied one: an edited or reordered entry
    // would be skipped silently in every database that already ran it.
    expect(migrationFolderProblems(folder)).toEqual([]);
  });

  it("agree with the schema files: db:generate would write nothing (No schema changes)", async () => {
    // A schema file changed without its migration would reach no database; a migration edited by
    // hand would make the next db:generate repeat or undo it (WP-10 D7, suite 1).
    expect(await pendingSchemaChanges()).toEqual([]);
  });
});
