import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { ApiConfig, GreetingService } from "./app.js";
import { Consumer } from "./consumer.js";

describe("row 1: Biome useImportType on an injected class", () => {
  it("resolves Consumer when its dependency is imported as a value", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Consumer, GreetingService, { provide: ApiConfig, useValue: { port: 1 } }],
    }).compile();
    expect(moduleRef.get(Consumer).run()).toBe("hello from port 1");
  });
});
