import { readFileSync } from "node:fs";
import { DiagnosticSeverity, Parser } from "@asyncapi/parser";
import { describe, expect, it } from "vitest";
import { buildAsyncApiDocument, eventContracts } from "../src/index.js";

const committed = JSON.parse(
  readFileSync(new URL("../asyncapi.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("AsyncAPI catalog", () => {
  it("is up to date with the contracts (run `pnpm --filter @jadero/contracts asyncapi`)", () => {
    expect(committed).toEqual(buildAsyncApiDocument());
  });

  it("is a valid AsyncAPI 3 document", async () => {
    const { diagnostics } = await new Parser().parse(JSON.stringify(committed));
    const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
    expect(errors.map((e) => `${e.path.join(".")}: ${e.message}`)).toEqual([]);
  });

  it("has one channel per event contract", () => {
    const channels = Object.keys(committed.channels as object);
    expect(channels).toEqual(eventContracts.map((c) => c.routingKey));
  });
});
