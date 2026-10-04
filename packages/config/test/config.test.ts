import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseConfig, integrationConfig, workersFromLoad } from "../vitest/base.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("tsconfig bases", () => {
  it("base is strict ESM for Node (ADR-004 and ADR-042)", () => {
    const base = read("../tsconfig/base.json");
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.module).toBe("NodeNext");
    expect(base.compilerOptions.verbatimModuleSyntax).toBe(true);
  });
  it("library emits declarations, service emits decorator metadata", () => {
    expect(read("../tsconfig/node-library.json").compilerOptions.declaration).toBe(true);
    expect(read("../tsconfig/node-service.json").compilerOptions.emitDecoratorMetadata).toBe(true);
  });
});

describe("workersFromLoad", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.VITEST_MAX_WORKERS;
    delete process.env.VITEST_MAX_WORKERS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VITEST_MAX_WORKERS;
    else process.env.VITEST_MAX_WORKERS = saved;
  });

  it("applies 12 minus load minus 3, clamped to 1..6", () => {
    expect(workersFromLoad(0)).toBe(6);
    expect(workersFromLoad(5)).toBe(4);
    expect(workersFromLoad(20)).toBe(1);
  });
  it("honors the override and clamps it to 1..6", () => {
    process.env.VITEST_MAX_WORKERS = "3";
    expect(workersFromLoad(0)).toBe(3);
    process.env.VITEST_MAX_WORKERS = "99";
    expect(workersFromLoad(0)).toBe(6);
  });
});

describe("unit and integration configs", () => {
  it("keeps *.int.test.ts out of the unit run and runs only them in the integration run", () => {
    expect(baseConfig().test?.exclude).toContain("**/*.int.test.ts");
    const integration = integrationConfig(["test/setup/global.ts"]).test;
    expect(integration?.include).toEqual(["test/**/*.int.test.ts"]);
    expect(integration?.globalSetup).toEqual(["test/setup/global.ts"]);
  });
});
