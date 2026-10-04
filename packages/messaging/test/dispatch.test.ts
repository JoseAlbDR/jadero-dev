import { systemPingV1 } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { dispatch, done } from "../src/index.js";

const ping = {
  specversion: "1.0",
  id: "0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f",
  source: "jadero/api",
  type: "dev.jadero.system.ping.v1",
  time: "2026-10-04T10:15:02.114Z",
  datacontenttype: "application/json",
  data: { trigger: "manual" },
};

function subscription(handle: () => Promise<ReturnType<typeof done>>) {
  return [{ queue: "test.a", contract: systemPingV1, handle }];
}

describe("dispatch", () => {
  it("dead-letters a body that is not an envelope (for example, not JSON)", async () => {
    const outcome = await dispatch(
      subscription(async () => done()),
      undefined,
      1,
      "test.a",
    );
    expect(outcome).toEqual({ kind: "dead", reason: "invalid envelope: (root)" });
  });

  it("dead-letters a type no subscription on the queue accepts", async () => {
    const other = { ...ping, type: "dev.jadero.content.published.v1" };
    const outcome = await dispatch(
      subscription(async () => done()),
      other,
      1,
      "test.a",
    );
    expect(outcome).toEqual({
      kind: "dead",
      reason: "no handler for dev.jadero.content.published.v1 on test.a",
    });
  });

  it("keeps only the error class and code in a retry reason, never the message", async () => {
    const failing = async () => {
      throw Object.assign(new Error("duplicate key value (email)=(someone@example.com)"), {
        code: "23505",
      });
    };
    const outcome = await dispatch(subscription(failing), ping, 1, "test.a");
    expect(outcome).toEqual({ kind: "retry", reason: "Error (23505)" });
  });

  it("names a thrown non-error without its content", async () => {
    const outcome = await dispatch(
      subscription(async () => {
        throw "secret";
      }),
      ping,
      1,
      "test.a",
    );
    expect(outcome).toEqual({ kind: "retry", reason: "handler threw" });
  });
});
