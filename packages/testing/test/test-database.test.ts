import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/test-database.js";

describe("createTestDatabase", () => {
  it("refuses an extension name that is not a plain identifier, before touching any database", async () => {
    await expect(
      createTestDatabase({ superuserExtensions: ["vector; DROP ROLE test"] }),
    ).rejects.toThrow("Not a plain extension name");
  });

  it("refuses a role whose name or setting is not plain, before touching any database", async () => {
    await expect(
      createTestDatabase({ roles: [{ name: "reader; DROP ROLE test", settings: {} }] }),
    ).rejects.toThrow("Not a plain role name");
    await expect(
      createTestDatabase({
        roles: [{ name: "reader", settings: { search_path: "'x'; DROP ROLE test" } }],
      }),
    ).rejects.toThrow("Not a plain setting");
  });
});
