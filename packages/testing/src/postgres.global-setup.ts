import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { useDockerContextHost } from "./docker-host.js";
import { POSTGRES_IMAGE } from "./images.js";
import {
  readProvisioningSnapshot,
  runProvisioning,
  SERVICE_PASSWORD_VARIABLES,
} from "./provision.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Superuser URL of the run's Postgres container; tests create their own database from it. */
    postgresAdminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts one Postgres container for the whole `pnpm test:int` run (WP-3 decision H) and
 * provisions it with `infra/postgres/provision.sql` and `env=dev`, as the dev container and the
 * servers are (WP-8 D4), so the tests run on the real roles, grants and extensions. A package
 * names this file in its `vitest.int.config.ts` (`@jadero/testing/postgres-global-setup`).
 * @param project the Vitest project, to provide the superuser URL and the provisioning snapshot.
 * @throws when provisioning fails, with psql's output (which never holds a password).
 */
export async function setup(project: TestProject): Promise<void> {
  useDockerContextHost();
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  // One random password for every provisioned role of this run: test-only, never printed.
  const password = randomBytes(24).toString("hex");
  const passwords = Object.fromEntries(SERVICE_PASSWORD_VARIABLES.map((name) => [name, password]));
  const result = await runProvisioning(container, "dev", passwords);
  if (result.exitCode !== 0) {
    throw new Error(`provision.sql failed (exit ${result.exitCode}): ${result.output}`);
  }
  const adminUrl = container.getConnectionUri();
  project.provide("postgresAdminUrl", adminUrl);
  project.provide("postgresProvisioning", await readProvisioningSnapshot(adminUrl, password));
}

/** Stops the container; Ryuk removes it too if the run crashes. */
export async function teardown(): Promise<void> {
  await container?.stop();
}
