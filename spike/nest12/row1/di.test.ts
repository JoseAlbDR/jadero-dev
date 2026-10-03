import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule, GreetingService } from "./app.js";

describe("row 1: constructor DI under Vitest (Oxc)", () => {
  it("resolves a provider whose constructor takes an abstract-class token", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(GreetingService).greet()).toBe("hello from port 3901");
    await moduleRef.close();
  });
});
