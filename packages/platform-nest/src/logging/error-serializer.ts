import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { stdSerializers } from "pino";

/**
 * The fields of a Postgres error that name what failed without the values involved. Never
 * `detail` ("Key (slug)=(x) already exists.", "Failing row contains (...)") nor `where`, which
 * carry row values, and never the bound parameters.
 */
const SAFE_DATABASE_FIELDS = ["code", "constraint", "table", "column", "schema"] as const;

/** How deep a `cause` chain is followed before the rest is left out. */
const MAX_CAUSE_DEPTH = 5;

/**
 * A database error with only the fields that are safe to log: the SQLSTATE code, the constraint,
 * table, column and schema, and the query text with its `$n` placeholders. The message names the
 * code only: Postgres messages can quote a value (`invalid input syntax for type uuid: "..."`).
 */
class RedactedQueryError extends Error {
  /**
   * @param fields the safe fields, written as the error's own properties.
   * @param frames the original stack without its first line, which embedded the unsafe message.
   * @param cause a cause that is not a database error (a connection timeout), already redacted.
   */
  constructor(fields: Record<string, string>, frames: string, cause: unknown) {
    super(
      typeof fields.code === "string"
        ? `Database query failed (SQLSTATE ${fields.code})`
        : "Database query failed",
      cause === undefined ? undefined : { cause },
    );
    this.name = "RedactedQueryError";
    Object.assign(this, fields);
    this.stack = `${this.name}: ${this.message}${frames}`;
  }
}

/** Drizzle's wrapper (`Failed query: <sql>\nparams: <values>`), checked by shape as well. */
function isDrizzleQueryError(value: Error): value is Error & { query: string; cause?: unknown } {
  if (value instanceof DrizzleQueryError) return true;
  const { query, params } = value as { query?: unknown; params?: unknown };
  return typeof query === "string" && Array.isArray(params);
}

/** A Postgres error from `pg` (`pg-protocol`'s `DatabaseError`), checked by shape as well. */
function isDatabaseError(value: unknown): value is DatabaseError {
  if (value instanceof DatabaseError) return true;
  const { code, severity } = value as { code?: unknown; severity?: unknown };
  return (
    value instanceof Error &&
    typeof severity === "string" &&
    typeof code === "string" &&
    /^[0-9A-Z]{5}$/.test(code)
  );
}

/**
 * The stack frames below the first line. The first line is `<name>: <message>`, and the message is
 * what must not be logged; when the stack does not start that way the frames are dropped.
 */
function framesOf(error: Error): string {
  const header = `${error.name}: ${error.message}`;
  return error.stack?.startsWith(header) ? error.stack.slice(header.length) : "";
}

/** The safe fields of a Postgres error, as strings. */
function safeFieldsOf(error: DatabaseError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of SAFE_DATABASE_FIELDS) {
    const value = error[key];
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

/**
 * Replaces every database error in an error and its `cause` chain by a {@link RedactedQueryError}.
 * Anything else is returned as it is (the same reference when nothing changed).
 * @param value whatever was logged under `err`.
 * @param depth how many causes deep this call is.
 * @returns the error to serialize.
 */
export function redactQueryErrors(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error) || depth > MAX_CAUSE_DEPTH) return value;
  if (isDrizzleQueryError(value)) {
    const { cause } = value;
    const database = isDatabaseError(cause) ? safeFieldsOf(cause) : {};
    const other = isDatabaseError(cause) ? undefined : redactQueryErrors(cause, depth + 1);
    return new RedactedQueryError({ ...database, query: value.query }, framesOf(value), other);
  }
  if (isDatabaseError(value)) {
    return new RedactedQueryError(safeFieldsOf(value), framesOf(value), undefined);
  }
  if (value.cause === undefined) return value;
  const cause = redactQueryErrors(value.cause, depth + 1);
  if (cause === value.cause) return value;
  // A copy with the redacted cause: the logged error is never changed in place.
  const copy: Error = Object.create(Object.getPrototypeOf(value));
  Object.assign(copy, value);
  Object.defineProperties(copy, {
    message: { value: value.message, writable: true, configurable: true },
    stack: { value: value.stack, writable: true, configurable: true },
    cause: { value: cause, writable: true, configurable: true, enumerable: false },
  });
  return copy;
}

/**
 * pino's `err` serializer for every process (WP-12 step 7b, Q1 A): pino's standard one, after
 * {@link redactQueryErrors}, so a failed query logs its code and SQL text but never its bound
 * parameters nor the row values in Postgres's `detail`. pino-http hands its serializer an
 * already-serialized error; the original is on its `raw` property.
 * @param value the error, or pino-http's serialized error.
 * @returns the serialized error.
 */
export function serializeError(value: unknown): unknown {
  const raw = (value as { raw?: unknown } | null)?.raw;
  const error = raw instanceof Error ? raw : value;
  return stdSerializers.err(redactQueryErrors(error) as Error);
}
