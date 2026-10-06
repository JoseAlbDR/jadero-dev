import { execFileSync } from "node:child_process";

/**
 * Testcontainers looks for Docker at `DOCKER_HOST`, `~/.testcontainers.properties` or
 * `/var/run/docker.sock`; it does not read the Docker CLI context, which is how OrbStack, Colima
 * and Docker Desktop expose their socket on macOS. When none of those is set, this asks the CLI
 * (`docker context inspect`) and sets `DOCKER_HOST`, so `pnpm test:int` works wherever
 * `pnpm dev:up` works. Test setup only; app code never reads the environment directly (ADR-043).
 * @param env the environment to read and update, normally `process.env`.
 * @returns the host now in `DOCKER_HOST`, or undefined when the CLI could not tell.
 */
export function useDockerContextHost(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DOCKER_HOST) return env.DOCKER_HOST;
  try {
    const host = execFileSync(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (host) env.DOCKER_HOST = host;
    return host || undefined;
  } catch {
    return undefined;
  }
}
