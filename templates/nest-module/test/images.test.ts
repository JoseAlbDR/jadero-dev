import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POSTGRES_IMAGE } from "./setup/images.js";

describe("test images", () => {
  it("use the same Postgres tag as the dev stack, so dev and tests cannot drift", () => {
    const compose = readFileSync(
      new URL("../../../infra/compose/compose.dev.yml", import.meta.url),
      "utf8",
    );
    expect(compose).toContain(`image: ${POSTGRES_IMAGE}`);
  });
});
