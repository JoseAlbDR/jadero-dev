import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConfigError,
  type LoadConfigIo,
  loadConfig,
  parseConfig,
} from "../src/config/load-config.js";
import { platformEnv } from "../src/config/platform-env.js";

const valid = { PORT: "3001", SERVICE_NAME: "api" };

/** Captures what loadConfig prints and stops it the way process.exit would. */
function fakeIo() {
  const lines: string[] = [];
  const io: LoadConfigIo = {
    write: (line) => lines.push(line),
    exit: (code) => {
      throw new Error(`exit ${code}`);
    },
  };
  return { io, lines };
}

describe("parseConfig", () => {
  it("parses a valid environment, coerces numbers and applies defaults", () => {
    expect(parseConfig(platformEnv, valid)).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      LOG_LEVEL: "info",
      SERVICE_NAME: "api",
    });
  });

  it("names every bad variable", () => {
    const error = (() => {
      try {
        parseConfig(platformEnv, { PORT: "not-a-port", LOG_LEVEL: "loud" });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map((issue) => issue.variable)).toEqual([
      "PORT",
      "LOG_LEVEL",
      "SERVICE_NAME",
    ]);
  });

  it("reads booleans with stringbool, where coerce.boolean would turn 'false' into true", () => {
    const schema = z.object({ FLAG: z.stringbool() });
    expect(parseConfig(schema, { FLAG: "false" })).toEqual({ FLAG: false });
    expect(z.coerce.boolean().parse("false")).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns the parsed config when the environment is valid", () => {
    const { io, lines } = fakeIo();
    expect(loadConfig(platformEnv, valid, io).PORT).toBe(3001);
    expect(lines).toEqual([]);
  });

  it("prints names and issues, never values, and exits with code 1", () => {
    const secret = "postgres://content:s3cr3t-value@db/content_dev";
    const schema = platformEnv.extend({ DATABASE_URL: z.url().startsWith("postgresql://") });
    const { io, lines } = fakeIo();
    expect(() =>
      loadConfig(schema, { ...valid, PORT: undefined, DATABASE_URL: secret }, io),
    ).toThrow("exit 1");
    expect(lines[0]).toBe("Invalid configuration, refusing to start:");
    expect(lines.slice(1).map((line) => line.trim().split(":")[0])).toEqual([
      "PORT",
      "DATABASE_URL",
    ]);
    expect(lines[1]).toContain("received undefined");
    expect(lines.join("\n")).not.toContain("s3cr3t-value");
  });
});
