import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { EventContract } from "./define-event.js";

type JsonSchema = { [key: string]: unknown };

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The JSON Schema a published event version is frozen as: its whole envelope, as producers write it.
 * @param contract the event contract.
 * @returns the draft-07 JSON Schema of the envelope.
 */
export function publishedSchema(contract: EventContract<string, z.ZodType>): JsonSchema {
  return z.toJSONSchema(contract.envelope, { target: "draft-7", io: "input" }) as JsonSchema;
}

/**
 * Lists what makes `current` incompatible with `published`, the frozen schema of the same event
 * version (WP-5 step 2b, ADR-029 rule 4). Within a version the only allowed change is a new
 * optional property, at any depth: everything else must stay identical, so producers and consumers
 * of that version can be deployed in any order (full compatibility). Removing or renaming a
 * property, making one required or optional, changing a type, a pattern or an enum: each breaks
 * either an older consumer or a newer one reading older messages, so it needs a new version.
 * @param published the frozen schema from `compat/<routingKey>.json`.
 * @param current the schema the contract produces now.
 * @param path where in the schema the comparison is, for the messages.
 * @returns one message per incompatibility; empty when compatible.
 */
export function compatibilityProblems(
  published: JsonSchema,
  current: JsonSchema,
  path = "",
): string[] {
  const at = path || "(root)";
  const problems: string[] = [];
  const publishedProps = isSchema(published.properties) ? published.properties : undefined;
  const currentProps = isSchema(current.properties) ? current.properties : undefined;

  if (publishedProps && currentProps) {
    const before = new Set((published.required as string[] | undefined) ?? []);
    const after = new Set((current.required as string[] | undefined) ?? []);
    for (const name of after) {
      if (!before.has(name)) problems.push(`${at}: "${name}" became required`);
    }
    for (const name of before) {
      if (!after.has(name)) problems.push(`${at}: "${name}" is no longer required`);
    }
    for (const [name, schema] of Object.entries(publishedProps)) {
      const next = currentProps[name];
      if (next === undefined) {
        problems.push(`${at}: "${name}" was removed or renamed`);
      } else if (isSchema(schema) && isSchema(next)) {
        problems.push(...compatibilityProblems(schema, next, `${path}/${name}`));
      }
    }
  }

  const keys = new Set([...Object.keys(published), ...Object.keys(current)]);
  for (const key of keys) {
    if (key === "properties" || key === "required") continue;
    if (!isDeepStrictEqual(published[key], current[key])) {
      problems.push(
        `${at}: "${key}" changed from ${JSON.stringify(published[key])} to ${JSON.stringify(current[key])}`,
      );
    }
  }
  return problems;
}
