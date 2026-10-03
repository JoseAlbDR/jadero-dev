import { Body, Controller, ForbiddenException, Get, Post } from "@nestjs/common";
import { z } from "zod";

const EchoBody = z.object({ email: z.email(), locale: z.enum(["es", "en", "de"]) });

/** Test-only routes for the problem-details end-to-end test (WP-3 trace 2). */
@Controller("__fixtures")
export class EchoController {
  @Post("echo")
  echo(@Body({ schema: EchoBody }) body: z.infer<typeof EchoBody>): z.infer<typeof EchoBody> {
    return body;
  }

  @Get("forbidden")
  forbidden(): never {
    throw new ForbiddenException("Not your draft.");
  }

  @Get("boom")
  boom(): never {
    throw new TypeError("Cannot read properties of undefined (reading 'title')");
  }
}
