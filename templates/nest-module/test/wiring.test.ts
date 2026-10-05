import { DatabaseModule } from "@jadero/platform-nest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { NotesModule } from "../src/modules/notes/index.js";
import { CreateWidget } from "../src/modules/widgets/application/create-widget.use-case.js";
import { IdGenerator } from "../src/modules/widgets/application/id-generator.js";
import { WidgetRepository } from "../src/modules/widgets/application/widget.repository.js";
import { WidgetsUnitOfWork } from "../src/modules/widgets/application/widgets.unit-of-work.js";
import { WidgetsModule } from "../src/modules/widgets/index.js";
import { DrizzleWidgetRepository } from "../src/modules/widgets/infrastructure/drizzle-widget.repository.js";
import { DrizzleWidgetsUnitOfWork } from "../src/modules/widgets/infrastructure/drizzle-widgets.unit-of-work.js";
import { RandomIdGenerator } from "../src/modules/widgets/infrastructure/random-id-generator.js";

describe("template wiring", () => {
  it("resolves both modules' providers, the hexagonal one through its port tokens", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotesModule, WidgetsModule],
    }).compile();
    const created = await moduleRef.get(CreateWidget).execute({ name: "lamp" });
    expect(created.name).toBe("lamp");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    // The unit of work and the read port share one store: what run committed is readable outside.
    expect((await moduleRef.get(WidgetRepository).findById(created.id))?.name).toBe("lamp");
    await moduleRef.close();
  });

  it("resolves the Drizzle binding of the README without a database (the pool connects lazily)", async () => {
    // The two provider lines the README tells a service to use, behind DatabaseModule.
    @Module({
      providers: [
        CreateWidget,
        { provide: WidgetRepository, useClass: DrizzleWidgetRepository },
        { provide: WidgetsUnitOfWork, useClass: DrizzleWidgetsUnitOfWork },
        { provide: IdGenerator, useClass: RandomIdGenerator },
      ],
    })
    class DrizzleWidgetsModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRoot({ url: "postgres://nobody@127.0.0.1:1/none", poolMax: 1 }),
        DrizzleWidgetsModule,
      ],
    }).compile();
    expect(moduleRef.get(WidgetRepository)).toBeInstanceOf(DrizzleWidgetRepository);
    expect(moduleRef.get(WidgetsUnitOfWork)).toBeInstanceOf(DrizzleWidgetsUnitOfWork);
    expect(moduleRef.get(CreateWidget)).toBeInstanceOf(CreateWidget);
    await moduleRef.close();
  });
});
