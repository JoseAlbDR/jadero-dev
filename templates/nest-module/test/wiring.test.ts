import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { NotesModule } from "../src/modules/notes/index.js";
import { CreateWidget } from "../src/modules/widgets/application/create-widget.use-case.js";
import { WidgetsModule } from "../src/modules/widgets/index.js";

describe("template wiring", () => {
  it("resolves both modules' providers, the hexagonal one through its port tokens", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotesModule, WidgetsModule],
    }).compile();
    const created = await moduleRef.get(CreateWidget).execute({ name: "lamp" });
    expect(created.name).toBe("lamp");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await moduleRef.close();
  });
});
