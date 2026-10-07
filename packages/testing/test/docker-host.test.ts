import { describe, expect, it } from "vitest";
import { useDockerContextHost } from "../src/docker-host.js";

describe("useDockerContextHost", () => {
  it("keeps a DOCKER_HOST that is already set", () => {
    const env: NodeJS.ProcessEnv = { DOCKER_HOST: "unix:///custom.sock" };
    expect(useDockerContextHost(env)).toBe("unix:///custom.sock");
    expect(env.DOCKER_HOST).toBe("unix:///custom.sock");
  });
});
