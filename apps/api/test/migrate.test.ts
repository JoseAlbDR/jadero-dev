import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // migrate.ts sets the exit code of the process it runs in; this test runs in Vitest's worker.
  process.exitCode = undefined;
});

describe("api migrate entry (src/migrate.ts)", () => {
  it("exits with code 1 and one line naming the cause, never the URL, when the database is unreachable", async () => {
    // Port 1 refuses at once: runMigrations throws a MigrationError before any SQL runs.
    vi.stubEnv("DATABASE_URL", "postgres://nobody:secret@127.0.0.1:1/none");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../src/migrate.js");
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(
      "api: cannot reach its database (DATABASE_URL): ECONNREFUSED",
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    // The first import loads the whole migrate graph in a cold worker, and the default 5 s equals
    // the migrator's connect timeout, which left no margin on a slow CI runner.
  }, 20_000);
});
