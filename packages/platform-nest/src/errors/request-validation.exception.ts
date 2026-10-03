import { BadRequestException } from "@nestjs/common";
import type { InvalidField } from "./problem-details.js";

/** The shape of a Standard Schema issue that this module reads (Zod, Valibot and ArkType match). */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * Turns a schema issue path into a JSON Pointer (RFC 6901) in URI fragment form:
 * `["items", 0, "name"]` becomes `#/items/0/name`; `~` and `/` inside a key are escaped.
 * @param path the issue path; empty or missing means the whole body.
 * @returns the pointer, `#` for the whole body.
 */
export function toJsonPointer(path: SchemaIssue["path"]): string {
  if (!path || path.length === 0) return "#";
  const segments = path.map((segment) => {
    const key = typeof segment === "object" && segment !== null ? segment.key : segment;
    return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  });
  return `#/${segments.join("/")}`;
}

/**
 * Thrown by the global validation pipe when a request does not match its schema. Keeps the
 * structured issues so the problem-details filter can answer with one pointer per field.
 */
export class RequestValidationException extends BadRequestException {
  readonly fields: readonly InvalidField[];

  constructor(issues: readonly SchemaIssue[]) {
    super("Request validation failed");
    this.fields = issues.map((issue) => ({
      pointer: toJsonPointer(issue.path),
      detail: issue.message,
    }));
  }
}
