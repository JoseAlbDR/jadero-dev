import { describe, expect, it } from "vitest";
import { inTransaction, type SqlClient, type SqlPool } from "../src/index.js";

/** A pool fake that records every statement and every release of its one connection. */
function fakePool(options: { failOn?: string } = {}) {
  const statements: string[] = [];
  const releases: (Error | boolean | undefined)[] = [];
  const client: SqlClient = {
    async query<R>(text: string) {
      statements.push(text);
      if (text === options.failOn) throw new Error(`${text} failed`);
      return { rows: [] as R[], rowCount: 0 };
    },
    release(error) {
      releases.push(error);
    },
  };
  const pool: SqlPool = { connect: async () => client };
  return { pool, statements, releases };
}

describe("inTransaction", () => {
  it("runs the work between BEGIN and COMMIT, returns its result and releases the connection", async () => {
    const { pool, statements, releases } = fakePool();
    const result = await inTransaction(pool, async (tx) => {
      await tx.query("INSERT 1");
      return "done";
    });
    expect(result).toBe("done");
    expect(statements).toEqual(["BEGIN", "INSERT 1", "COMMIT"]);
    expect(releases).toEqual([undefined]);
  });

  it("rolls back, destroys the connection and rethrows when the work throws", async () => {
    const { pool, statements, releases } = fakePool();
    const failure = new Error("effect failed");
    await expect(
      inTransaction(pool, async (tx) => {
        await tx.query("INSERT 1");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(statements).toEqual(["BEGIN", "INSERT 1", "ROLLBACK"]);
    expect(releases).toEqual([true]);
  });

  it("keeps the work's error when the ROLLBACK fails too, and still releases once", async () => {
    const { pool, releases } = fakePool({ failOn: "ROLLBACK" });
    await expect(
      inTransaction(pool, async () => {
        throw new Error("effect failed");
      }),
    ).rejects.toThrow("effect failed");
    expect(releases).toEqual([true]);
  });

  it("rolls back and destroys the connection when the COMMIT fails", async () => {
    const { pool, statements, releases } = fakePool({ failOn: "COMMIT" });
    await expect(inTransaction(pool, async () => "never returned")).rejects.toThrow(
      "COMMIT failed",
    );
    expect(statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(releases).toEqual([true]);
  });
});
