import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseProvisionedExtensions,
  provisionedExtensions,
} from "../src/provisioned-extensions.js";

describe("provisionedExtensions, against the repo's init script", () => {
  it("gives agent_dev the vector extension, the list the agent's tests pass to the superuser", () => {
    expect(provisionedExtensions("agent_dev")).toEqual(["vector"]);
  });

  it("fails loudly when the script is missing", () => {
    const folder = mkdtempSync(join(tmpdir(), "provisioned-"));
    try {
      expect(() => provisionedExtensions("agent_dev", join(folder, "missing.sql"))).toThrow(
        "Provisioning script not found",
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reads a script given by path", () => {
    const folder = mkdtempSync(join(tmpdir(), "provisioned-"));
    try {
      const script = join(folder, "init.sql");
      writeFileSync(script, "\\connect shop_dev\nCREATE EXTENSION citext;\n");
      expect(provisionedExtensions("shop_dev", script)).toEqual(["citext"]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("parseProvisionedExtensions", () => {
  const script = [
    "-- comment: CREATE EXTENSION ignored;",
    "CREATE ROLE agent LOGIN PASSWORD 'agent';",
    "\\connect agent_dev",
    "CREATE EXTENSION IF NOT EXISTS vector;",
    "create extension pg_trgm;",
    "\\c content_dev",
    "CREATE EXTENSION unaccent;",
    "\\connect contact_dev",
  ].join("\n");

  it("collects only the extensions created after the database's \\connect", () => {
    expect(parseProvisionedExtensions(script, "agent_dev")).toEqual(["vector", "pg_trgm"]);
    expect(parseProvisionedExtensions(script, "content_dev")).toEqual(["unaccent"]);
  });

  it("returns an empty list for a block that creates no extension", () => {
    expect(parseProvisionedExtensions(script, "contact_dev")).toEqual([]);
  });

  it("ignores extensions created before any \\connect, in the default database", () => {
    expect(
      parseProvisionedExtensions("CREATE EXTENSION hstore;\n\\connect agent_dev\n", "agent_dev"),
    ).toEqual([]);
  });

  it("fails loudly when the script never connects to the database", () => {
    expect(() => parseProvisionedExtensions(script, "media_dev")).toThrow(
      'no "\\connect media_dev" block',
    );
  });

  it("refuses a CREATE EXTENSION it cannot read, instead of skipping it", () => {
    expect(() =>
      parseProvisionedExtensions('\\connect agent_dev\nCREATE EXTENSION "uuid-ossp";', "agent_dev"),
    ).toThrow("line 2");
    expect(() =>
      parseProvisionedExtensions(
        "\\connect agent_dev\nCREATE EXTENSION vector SCHEMA x;",
        "agent_dev",
      ),
    ).toThrow("CREATE EXTENSION [IF NOT EXISTS] <name>;");
  });

  it("refuses a \\connect with more than a database name", () => {
    expect(() => parseProvisionedExtensions("\\connect agent_dev agent", "agent_dev")).toThrow(
      'expected "\\connect <database>"',
    );
  });

  it("refuses a database name that is not a plain identifier", () => {
    expect(() => parseProvisionedExtensions(script, "agent-dev")).toThrow(
      "Not a plain database name",
    );
  });
});
