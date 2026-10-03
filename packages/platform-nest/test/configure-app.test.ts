import { Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { configureApp } from "../src/bootstrap/configure-app.js";

@Injectable()
class ShutdownProbe implements OnApplicationShutdown {
  signal: string | undefined;

  onApplicationShutdown(signal?: string): void {
    this.signal = signal ?? "close";
  }
}

@Module({ providers: [ShutdownProbe] })
class ProbeModule {}

describe("configureApp", () => {
  it("returns the same app, which closes through the lifecycle hooks", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    expect(configureApp(app)).toBe(app);
    await app.init();
    const probe = app.get(ShutdownProbe);
    await app.close();
    expect(probe.signal).toBe("close");
  });
});
