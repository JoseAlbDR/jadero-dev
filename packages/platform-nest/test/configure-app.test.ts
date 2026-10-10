import {
  Controller,
  Get,
  Injectable,
  Module,
  type OnApplicationShutdown,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { APP_OPTIONS, configureApp } from "../src/bootstrap/configure-app.js";
import { LoggingModule } from "../src/logging/logging.module.js";
import { createApp } from "./create-app.js";
import { memoryStream } from "./memory-stream.js";

@Injectable()
class ShutdownProbe implements OnApplicationShutdown {
  signal: string | undefined;

  onApplicationShutdown(signal?: string): void {
    this.signal = signal ?? "close";
  }
}

@Module({ providers: [ShutdownProbe] })
class ProbeModule {}

/** A public route at version 1, like the content reads. */
@Controller({ path: "things", version: "1" })
class VersionedController {
  @Get()
  list(): { version: string } {
    return { version: "1" };
  }
}

/** An operational route, like `/health`. */
@Controller({ path: "ops", version: VERSION_NEUTRAL })
class NeutralController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [VersionedController, NeutralController] })
class RoutesModule {}

describe("configureApp", () => {
  it("returns the same app, which closes through the lifecycle hooks", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          serviceName: "probe",
          level: "info",
          pretty: false,
          destination: memoryStream(),
        }),
        ProbeModule,
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    expect(configureApp(app, { HTTP_JSON_BODY_LIMIT: "100kb" })).toBe(app);
    await app.init();
    const probe = app.get(ShutdownProbe);
    await app.close();
    expect(probe.signal).toBe("close");
  });

  it("versions routes in the URI: /v1 for a versioned controller, no prefix for a neutral one", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot({
          serviceName: "probe",
          level: "fatal",
          pretty: false,
          destination: memoryStream(),
        }),
        RoutesModule,
      ],
    }).compile();
    const app = createApp(moduleRef);
    await app.init();
    const http = () => request(app.getHttpServer());
    try {
      expect((await http().get("/v1/things")).status).toBe(200);
      expect((await http().get("/things")).status).toBe(404);
      expect((await http().get("/ops")).status).toBe(200);
      // Neutral means "no version segment", not "any version".
      expect((await http().get("/v1/ops")).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
