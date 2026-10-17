import { describe, expect, it } from "vitest";
import {
  assertPlainRole,
  type ProvisioningSnapshot,
  provisionedExtensions,
  provisionedRoles,
} from "../src/provisioned.js";

// The shape the global setup reads after running provision.sql with env=dev; the real run is
// proven by test/provision.int.test.ts and by every service's integration suite.
const snapshot: ProvisioningSnapshot = {
  databases: {
    agent_dev: { extensions: ["vector"], roles: [] },
    content_dev: {
      extensions: [],
      roles: [{ name: "content_reader_dev", password: "test-only" }],
    },
  },
};

describe("provisionedExtensions", () => {
  it("gives the extensions provisioning created in one database", () => {
    expect(provisionedExtensions("agent_dev", snapshot)).toEqual(["vector"]);
    expect(provisionedExtensions("content_dev", snapshot)).toEqual([]);
  });

  it("refuses a database provisioning never created, naming the ones it did", () => {
    expect(() => provisionedExtensions("shop_dev", snapshot)).toThrow(
      "Provisioning created no database shop_dev (it created: agent_dev, content_dev)",
    );
    expect(() => provisionedExtensions("shop_dev", { databases: {} })).toThrow("created: none");
  });

  it("refuses a database name that is not a plain identifier", () => {
    expect(() => provisionedExtensions("agent-dev", snapshot)).toThrow("Not a plain database name");
  });

  it("returns a copy, so a caller cannot change the shared snapshot", () => {
    provisionedExtensions("agent_dev", snapshot).push("hstore");
    expect(provisionedExtensions("agent_dev", snapshot)).toEqual(["vector"]);
  });
});

describe("provisionedRoles", () => {
  it("gives the extra login roles of one database, the reader for content_dev", () => {
    expect(provisionedRoles("content_dev", snapshot)).toEqual([
      { name: "content_reader_dev", password: "test-only" },
    ]);
    expect(provisionedRoles("agent_dev", snapshot)).toEqual([]);
  });

  it("refuses a database provisioning never created", () => {
    expect(() => provisionedRoles("contact_dev", snapshot)).toThrow("no database contact_dev");
  });
});

describe("assertPlainRole", () => {
  it("accepts a plain name and refuses anything that could change the SQL text", () => {
    expect(() => assertPlainRole({ name: "content_reader_dev", password: "x" })).not.toThrow();
    expect(() => assertPlainRole({ name: "a; DROP ROLE b", password: "x" })).toThrow(
      "Not a plain role name",
    );
  });
});
