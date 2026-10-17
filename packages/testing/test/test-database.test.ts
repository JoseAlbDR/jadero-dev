import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/test-database.js";

describe("createTestDatabase", () => {
  it("refuses an extension name that is not a plain identifier, before touching any database", async () => {
    await expect(
      createTestDatabase({ superuserExtensions: ["vector; DROP ROLE test"] }),
    ).rejects.toThrow("Not a plain extension name");
  });

  it("refuses a role whose name is not plain, before touching any database", async () => {
    await expect(
      createTestDatabase({ roles: [{ name: "reader; DROP ROLE test", password: "x" }] }),
    ).rejects.toThrow("Not a plain role name");
  });
});
