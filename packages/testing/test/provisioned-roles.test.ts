import { describe, expect, it } from "vitest";
import { parseProvisionedRoles, provisionedRoles } from "../src/provisioned-roles.js";

describe("provisionedRoles, against the repo's init script", () => {
  it("gives content_dev the read-only content_reader, the role api's migration grants to", () => {
    expect(provisionedRoles("content_dev")).toEqual([
      { name: "content_reader", settings: { default_transaction_read_only: "on" } },
    ]);
  });

  it("gives the other databases no extra role", () => {
    expect(provisionedRoles("agent_dev")).toEqual([]);
    expect(provisionedRoles("contact_dev")).toEqual([]);
  });
});

describe("parseProvisionedRoles", () => {
  const script = [
    "CREATE ROLE shop LOGIN PASSWORD 'shop';",
    "CREATE DATABASE shop_dev OWNER shop;",
    "REVOKE CONNECT ON DATABASE shop_dev FROM PUBLIC;",
    "CREATE ROLE shop_reader LOGIN PASSWORD 'shop_reader';",
    "GRANT CONNECT ON DATABASE shop_dev TO shop_reader;",
    "ALTER ROLE shop_reader SET default_transaction_read_only = on;",
    "ALTER ROLE shop_reader SET statement_timeout TO 5000;",
  ].join("\n");

  it("collects the roles granted CONNECT on the database, with their settings", () => {
    expect(parseProvisionedRoles(script, "shop_dev")).toEqual([
      {
        name: "shop_reader",
        settings: { default_transaction_read_only: "on", statement_timeout: "5000" },
      },
    ]);
  });

  it("returns nothing for a database with no granted role", () => {
    expect(parseProvisionedRoles(script, "other_dev")).toEqual([]);
  });

  it("refuses a granted role the script never creates with LOGIN", () => {
    expect(() =>
      parseProvisionedRoles(
        "CREATE ROLE ghost NOLOGIN;\nGRANT CONNECT ON DATABASE shop_dev TO ghost;",
        "shop_dev",
      ),
    ).toThrow("never created with LOGIN");
  });

  it("refuses a GRANT CONNECT or ALTER ROLE line it cannot read, instead of skipping it", () => {
    expect(() =>
      parseProvisionedRoles("GRANT CONNECT ON DATABASE shop_dev TO a, b;", "shop_dev"),
    ).toThrow("line 1");
    expect(() =>
      parseProvisionedRoles("ALTER ROLE r SET search_path = 'a, b';", "shop_dev"),
    ).toThrow('expected "ALTER ROLE <role> SET <key> = <value>;"');
  });

  it("refuses a database name that is not a plain identifier", () => {
    expect(() => parseProvisionedRoles(script, "shop-dev")).toThrow("Not a plain database name");
  });
});
