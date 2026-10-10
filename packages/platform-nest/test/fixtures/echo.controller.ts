import { Body, Controller, ForbiddenException, Get, Post } from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { z } from "zod";

const EchoBody = z.object({ email: z.email(), locale: z.enum(["es", "en", "de"]) });

/**
 * A failed insert as Drizzle throws it: the wrapper names the SQL and the bound values, its pg
 * cause the code, the constraint and, in `detail`, the row's values.
 * @returns the error, with `secret-slug` and `ada@example.com` in the values only.
 */
export function failedInsert(): DrizzleQueryError {
  const cause = Object.assign(
    new DatabaseError(
      'duplicate key value violates unique constraint "project_slug_key"',
      120,
      "error",
    ),
    {
      severity: "ERROR",
      code: "23505",
      detail: "Key (slug)=(secret-slug) already exists.",
      where: "SQL statement with ada@example.com",
      schema: "content",
      table: "project",
      constraint: "project_slug_key",
    },
  );
  return new DrizzleQueryError(
    'insert into "content"."project" ("slug", "owner_email") values ($1, $2)',
    ["secret-slug", "ada@example.com"],
    cause,
  );
}

/** Test-only routes for the problem-details and hardening end-to-end tests (WP-3 trace 2). */
@Controller("__fixtures")
export class EchoController {
  @Get("ok")
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Get("query-error")
  queryError(): never {
    throw failedInsert();
  }

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
