import { DatabaseError } from "pg";
import { pinoHttp } from "pino-http";
import { describe, expect, it } from "vitest";
import { redactQueryErrors, serializeError } from "../src/logging/error-serializer.js";
import { loggerParams } from "../src/logging/logger-params.js";
import { failedInsert } from "./fixtures/echo.controller.js";
import { memoryStream } from "./memory-stream.js";

const SECRETS = ["secret-slug", "ada@example.com", "already exists", "Failing row"];

const expectNoSecrets = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

/** A bare `pg` error whose message quotes the value, as Postgres does for a bad input. */
function badUuid(): DatabaseError {
  return Object.assign(
    new DatabaseError('invalid input syntax for type uuid: "secret-slug"', 98, "error"),
    { severity: "ERROR", code: "22P02", where: "unnamed portal parameter $1 = 'secret-slug'" },
  );
}

/** The pino logger the platform builds, writing to memory, as in every process. */
function platformLogger() {
  const stream = memoryStream();
  const params = loggerParams({
    serviceName: "probe",
    level: "info",
    pretty: false,
    destination: stream,
  });
  const [options, destination] = params.pinoHttp as [object, typeof stream];
  return { logger: pinoHttp(options, destination).logger, stream };
}

type PlatformLogger = ReturnType<typeof platformLogger>["logger"];

describe("the err serializer (WP-12 step 7b, Q1 A)", () => {
  it("keeps the code, constraint, table, schema and SQL of a Drizzle query error", () => {
    const serialized = serializeError(failedInsert());
    expect(serialized).toMatchObject({
      type: "RedactedQueryError",
      message: "Database query failed (SQLSTATE 23505)",
      code: "23505",
      constraint: "project_slug_key",
      table: "project",
      schema: "content",
      query: 'insert into "content"."project" ("slug", "owner_email") values ($1, $2)',
    });
    expect(serialized).not.toHaveProperty("params");
    expect(serialized).not.toHaveProperty("detail");
    expect(serialized).not.toHaveProperty("where");
    expectNoSecrets(serialized);
  });

  it("rebuilds the stack without the message that carried the values", () => {
    const { stack } = serializeError(failedInsert()) as { stack: string };
    expect(stack).toMatch(/^RedactedQueryError: Database query failed \(SQLSTATE 23505\)\n\s+at /);
    expect(stack).toContain("failedInsert");
  });

  it("redacts a bare pg error, whose own message can quote a value", () => {
    const serialized = serializeError(badUuid());
    expect(serialized).toMatchObject({ type: "RedactedQueryError", code: "22P02" });
    expect(serialized).not.toHaveProperty("query");
    expectNoSecrets(serialized);
  });

  it("redacts a query error deep in a cause chain, without changing the logged error", () => {
    const query = failedInsert();
    const outer = new Error("saving the project failed", { cause: query });
    const serialized = serializeError(outer) as { message: string; stack: string };
    expect(serialized.message).toBe(
      "saving the project failed: Database query failed (SQLSTATE 23505)",
    );
    expect(serialized.stack).toContain("caused by: RedactedQueryError");
    expectNoSecrets(serialized);
    expect(outer.cause).toBe(query);
  });

  it("reads the original from pino-http's already-serialized error", () => {
    const preSerialized = Object.create(null, {
      raw: { value: failedInsert(), enumerable: false },
      message: { value: "Failed query: ... params: secret-slug", enumerable: true },
    });
    expectNoSecrets(serializeError(preSerialized));
  });

  it("leaves any other error as it is", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'title')");
    expect(redactQueryErrors(error)).toBe(error);
    expect(serializeError(error)).toMatchObject({ type: "TypeError", message: error.message });
    expect(serializeError("not an error")).toBe("not an error");
  });
});

describe("a database error logged through the platform logger", () => {
  it.each([
    ["logger.error(err)", (logger: PlatformLogger) => logger.error(failedInsert())],
    ["logger.error({ err })", (logger: PlatformLogger) => logger.error({ err: failedInsert() })],
    [
      "logger.error(err, msg)",
      (logger: PlatformLogger) => logger.error(failedInsert(), "relay batch failed"),
    ],
  ])("%s never writes the values, in msg or err", (_call, log) => {
    const { logger, stream } = platformLogger();
    log(logger);
    expect(stream.lines).toHaveLength(1);
    const [line] = stream.lines;
    expect(line?.err).toMatchObject({ code: "23505", type: "RedactedQueryError" });
    expect(line?.msg).not.toContain("Failed query");
    expectNoSecrets(line);
  });
});
