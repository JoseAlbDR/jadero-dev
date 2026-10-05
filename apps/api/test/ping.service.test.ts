import { systemPingV1 } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryPingUnitOfWork } from "../src/modules/ping/infrastructure/in-memory-ping.unit-of-work.js";
import { PingService } from "../src/modules/ping/ping.service.js";

describe("PingService (on the unit of work fake)", () => {
  it("writes one system.ping.v1 to the outbox in one unit of work and returns its id", async () => {
    const uow = new InMemoryPingUnitOfWork();
    const id = await new PingService(uow).send("manual");
    expect(uow.outbox).toHaveLength(1);
    expect(uow.outbox[0]).toMatchObject({
      id,
      type: systemPingV1.type,
      source: "jadero/api",
      data: { trigger: "manual" },
    });
  });

  it("discards the outbox rows of a unit of work whose work throws (the fake's rollback)", async () => {
    const uow = new InMemoryPingUnitOfWork();
    await expect(
      uow.run(async ({ outbox }) => {
        await outbox.add(systemPingV1, { trigger: "heartbeat" });
        throw new Error("use case failed after the outbox write");
      }),
    ).rejects.toThrow("use case failed");
    expect(uow.outbox).toEqual([]);
  });
});
