import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workersFromLoad } from "../vitest/base.js";

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
  it("stays between 1 and 6 and honors the override", () => {
    const n = workersFromLoad();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
    process.env.VITEST_MAX_WORKERS = "3";
    expect(workersFromLoad()).toBe(3);
    delete process.env.VITEST_MAX_WORKERS;
  });
});
