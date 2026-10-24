import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { EventContract } from "./define-event.js";

type JsonSchema = { [key: string]: unknown };

/** The JSON Schema keywords a Zod union is emitted as: `oneOf` for a discriminated union. */
const UNION_KEYS = ["oneOf", "anyOf"] as const;

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
 * A discriminated union (`oneOf` or `anyOf` whose branches share a `const` property) is compared
 * branch by branch, so the same rules apply inside each branch; see `branchProblems`.
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

  const paired = new Set<string>();
  for (const key of UNION_KEYS) {
    const branches = branchProblems(published[key], current[key], `${path}/${key}`, at);
    if (branches) {
      paired.add(key);
      problems.push(...branches);
    }
  }

  const keys = new Set([...Object.keys(published), ...Object.keys(current)]);
  for (const key of keys) {
    if (key === "properties" || key === "required" || paired.has(key)) continue;
    if (!isDeepStrictEqual(published[key], current[key])) {
      problems.push(
        `${at}: "${key}" changed from ${JSON.stringify(published[key])} to ${JSON.stringify(current[key])}`,
      );
    }
  }
  return problems;
}

/**
 * Reads the `const` a union branch holds for one property.
 * @param branch one branch of the union.
 * @param name the property.
 * @returns the constant, or undefined when the property has none.
 */
function constOf(branch: JsonSchema, name: string): unknown {
  const properties = isSchema(branch.properties) ? branch.properties : undefined;
  const property = properties?.[name];
  return isSchema(property) ? property.const : undefined;
}

/**
 * Finds the property that tells the branches of a union apart: one that holds a `const` in every
 * branch of both lists, with no value repeated within a list (the `aggregate` of
 * `content.published.v1`, for example).
 * @param published the frozen branches.
 * @param current the branches the contract produces now.
 * @returns the property name, or undefined when the branches cannot be paired.
 */
function discriminatorOf(published: JsonSchema[], current: JsonSchema[]): string | undefined {
  const pairsBy = (branches: JsonSchema[], name: string): boolean => {
    const values = branches.map((branch) => constOf(branch, name));
    return (
      values.every((value) => value !== undefined) &&
      new Set(values.map((value) => JSON.stringify(value))).size === values.length
    );
  };
  const [first] = published;
  if (!first || !isSchema(first.properties)) return undefined;
  return Object.keys(first.properties).find(
    (name) => pairsBy(published, name) && pairsBy(current, name),
  );
}

/**
 * Compares two branch lists of a union pair by pair, matched by their discriminator value, and
 * applies `compatibilityProblems` inside each pair, so a new optional property inside one branch
 * is allowed and anything else it refuses is refused there too. A frozen branch missing now is
 * breaking: a producer can no longer send what a consumer still handles. A new branch is refused
 * as well, the same way an added enum value is: a consumer of this version that switches over the
 * discriminator exhaustively, or validates against its own copy of the union, would reject it.
 * @param published the frozen value of the `oneOf` or `anyOf` keyword.
 * @param current the current value of the same keyword.
 * @param path where in the schema the keyword is, for the messages.
 * @param at the path of the schema that holds the keyword, for the messages.
 * @returns the problems, or undefined when the two are not both branch lists with a
 * discriminator, so the caller compares the keyword whole.
 */
function branchProblems(
  published: unknown,
  current: unknown,
  path: string,
  at: string,
): string[] | undefined {
  if (!Array.isArray(published) || !Array.isArray(current)) return undefined;
  if (!published.every(isSchema) || !current.every(isSchema)) return undefined;
  const name = discriminatorOf(published, current);
  if (name === undefined) return undefined;

  const keyOf = (branch: JsonSchema): string => JSON.stringify(constOf(branch, name));
  const label = (value: string) => `${path.slice(path.lastIndexOf("/") + 1)}[${name}=${value}]`;
  const currentByValue = new Map(current.map((branch) => [keyOf(branch), branch]));
  const publishedValues = new Set(published.map(keyOf));
  const problems: string[] = [];
  for (const branch of published) {
    const value = keyOf(branch);
    const next = currentByValue.get(value);
    if (next === undefined) {
      problems.push(`${at}: ${label(value)} was removed`);
    } else {
      problems.push(...compatibilityProblems(branch, next, `${path}[${name}=${value}]`));
    }
  }
  for (const value of currentByValue.keys()) {
    if (!publishedValues.has(value)) problems.push(`${at}: ${label(value)} was added`);
  }
  return problems;
}
