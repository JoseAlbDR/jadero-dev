import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compatibilityProblems,
  defineEvent,
  eventContracts,
  publishedSchema,
} from "../src/index.js";

function frozen(routingKey: string): Record<string, unknown> {
  const url = new URL(`../compat/${routingKey}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

describe("published event versions stay compatible (expand only)", () => {
  // The gate against contract drift: within a version only optional properties may be added, so
  // an old consumer and a new producer (or the reverse) work during a deploy. Anything else is a
  // new version published alongside the old one (ADR-029 rule 4).
  it.each(eventContracts.map((c) => [c.routingKey, c] as const))(
    "%s matches its frozen schema, or only adds optional fields",
    (routingKey, contract) => {
      const file = new URL(`../compat/${routingKey}.json`, import.meta.url);
      expect(existsSync(file), `no compat/${routingKey}.json: run compat:accept`).toBe(true);
      expect(compatibilityProblems(frozen(routingKey), publishedSchema(contract))).toEqual([]);
    },
  );

  it.each(eventContracts.map((c) => [c.routingKey, c] as const))(
    "%s: the frozen schema is current (run `pnpm --filter @jadero/contracts compat:accept`)",
    (routingKey, contract) => {
      expect(frozen(routingKey)).toEqual(publishedSchema(contract));
    },
  );

  it("keeps no snapshot for a version that has no contract", () => {
    const keys = new Set(eventContracts.map((c) => `${c.routingKey}.json`));
    const snapshots = readdirSync(new URL("../compat/", import.meta.url));
    expect(snapshots.filter((f) => !keys.has(f))).toEqual([]);
  });
});

describe("compatibilityProblems", () => {
  const v1 = publishedSchema(
    defineEvent(
      "demo.thing.v1",
      z.object({ name: z.string(), kind: z.enum(["a", "b"]), note: z.string().optional() }),
    ),
  );
  const changed = (data: z.ZodType) => publishedSchema(defineEvent("demo.thing.v1", data));

  it("accepts the same schema", () => {
    expect(compatibilityProblems(v1, v1)).toEqual([]);
  });

  it("accepts a new optional field", () => {
    const next = changed(
      z.object({
        name: z.string(),
        kind: z.enum(["a", "b"]),
        note: z.string().optional(),
        region: z.string().optional(),
      }),
    );
    expect(compatibilityProblems(v1, next)).toEqual([]);
  });

  it.each([
    [
      "a new required field",
      z.object({
        name: z.string(),
        kind: z.enum(["a", "b"]),
        note: z.string().optional(),
        region: z.string(),
      }),
      /"region" became required/,
    ],
    [
      "a renamed field",
      z.object({ title: z.string(), kind: z.enum(["a", "b"]), note: z.string().optional() }),
      /"name" was removed or renamed/,
    ],
    [
      "a field made optional",
      z.object({
        name: z.string().optional(),
        kind: z.enum(["a", "b"]),
        note: z.string().optional(),
      }),
      /"name" is no longer required/,
    ],
    [
      "a changed type",
      z.object({ name: z.number(), kind: z.enum(["a", "b"]), note: z.string().optional() }),
      /\/data\/name: "type" changed/,
    ],
    [
      "an added enum value",
      z.object({ name: z.string(), kind: z.enum(["a", "b", "c"]), note: z.string().optional() }),
      /\/data\/kind: "enum" changed/,
    ],
    [
      "a removed enum value",
      z.object({ name: z.string(), kind: z.enum(["a"]), note: z.string().optional() }),
      /\/data\/kind: "enum" changed/,
    ],
  ])("refuses %s", (_, data, message) => {
    const problems = compatibilityProblems(v1, changed(data));
    expect(problems.join("\n")).toMatch(message);
  });
});

describe("compatibilityProblems on a discriminated union", () => {
  // A z.discriminatedUnion freezes as `oneOf`. Each frozen branch is paired with the current one
  // that has the same discriminator value and compared with the object rules above, so a new
  // optional field inside one branch is allowed, as it is in a plain object.
  const a = { kind: z.literal("a"), name: z.string() };
  const b = { kind: z.literal("b"), size: z.number() };
  const union = (...branches: z.ZodObject[]) =>
    publishedSchema(
      defineEvent(
        "demo.union.v1",
        z.discriminatedUnion("kind", branches as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]),
      ),
    );
  const v1 = union(z.object(a), z.object(b));

  it("accepts the same union", () => {
    expect(compatibilityProblems(v1, v1)).toEqual([]);
  });

  it("accepts a new optional field inside one branch", () => {
    const next = union(z.object({ ...a, note: z.string().optional() }), z.object(b));
    expect(compatibilityProblems(v1, next)).toEqual([]);
  });

  it("accepts the branches in another order", () => {
    expect(compatibilityProblems(v1, union(z.object(b), z.object(a)))).toEqual([]);
  });

  it.each([
    [
      "a new required field inside one branch",
      union(z.object({ ...a, region: z.string() }), z.object(b)),
      /\/data\/oneOf\[kind="a"\]: "region" became required/,
    ],
    [
      "a field removed inside one branch",
      union(z.object(a), z.object({ kind: z.literal("b") })),
      /\/data\/oneOf\[kind="b"\]: "size" was removed or renamed/,
    ],
    [
      "a changed type inside one branch",
      union(z.object(a), z.object({ kind: z.literal("b"), size: z.string() })),
      /\/data\/oneOf\[kind="b"\]\/size: "type" changed/,
    ],
    [
      "a new branch, like an added enum value",
      union(z.object(a), z.object(b), z.object({ kind: z.literal("c") })),
      /oneOf\[kind="c"\] was added/,
    ],
  ])("refuses %s", (_, next, message) => {
    expect(compatibilityProblems(v1, next).join("\n")).toMatch(message);
  });

  it("refuses a removed branch", () => {
    const c = z.object({ kind: z.literal("c") });
    const problems = compatibilityProblems(union(z.object(a), z.object(b), c), v1);
    expect(problems).toEqual(['/data: oneOf[kind="c"] was removed']);
  });

  it("compares a union without a discriminator whole", () => {
    const plain = (...members: z.ZodType[]) =>
      publishedSchema(
        defineEvent("demo.union.v1", z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]])),
      );
    const before = plain(z.object({ name: z.string() }), z.object({ size: z.number() }));
    const after = plain(
      z.object({ name: z.string(), note: z.string().optional() }),
      z.object({ size: z.number() }),
    );
    expect(compatibilityProblems(before, after).join("\n")).toMatch(/\/data: "anyOf" changed/);
  });
});
