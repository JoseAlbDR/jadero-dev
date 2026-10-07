import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/test-database.js";

describe("createTestDatabase", () => {
  it("refuses an extension name that is not a plain identifier, before touching any database", async () => {
    await expect(
      createTestDatabase({ superuserExtensions: ["vector; DROP ROLE test"] }),
    ).rejects.toThrow("Not a plain extension name");
  });
});
