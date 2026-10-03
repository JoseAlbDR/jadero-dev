import "reflect-metadata";
import {
  type BeforeApplicationShutdown,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  Post,
  StandardSchemaValidationPipe,
} from "@nestjs/common";
import { z } from "zod";

/** Abstract class as DI token (option B2). */
export abstract class ApiConfig {
  abstract readonly port: number;
}

/** Records lifecycle hook order so the spike can print it. */
export const hookLog: string[] = [];

@Injectable()
export class GreetingService
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(private readonly config: ApiConfig) {}

  /** Returns a greeting that proves the constructor dependency resolved. */
  greet(): string {
    return `hello from port ${this.config.port}`;
  }

  onModuleDestroy(): void {
    hookLog.push("onModuleDestroy");
  }
  beforeApplicationShutdown(): void {
    hookLog.push("beforeApplicationShutdown");
  }
  onApplicationShutdown(): void {
    hookLog.push("onApplicationShutdown");
  }
}

const EchoBody = z.object({ email: z.email(), locale: z.enum(["es", "en", "de"]) });

@Controller()
export class AppController {
  constructor(private readonly greeting: GreetingService) {}

  @Get("greet")
  greet(): { msg: string } {
    return { msg: this.greeting.greet() };
  }

  @Post("echo")
  echo(@Body({ schema: EchoBody }) body: z.infer<typeof EchoBody>): z.infer<typeof EchoBody> {
    return body;
  }
}

@Module({
  controllers: [AppController],
  providers: [GreetingService, { provide: ApiConfig, useValue: { port: 3901 } }],
})
export class AppModule {}

export { StandardSchemaValidationPipe };
