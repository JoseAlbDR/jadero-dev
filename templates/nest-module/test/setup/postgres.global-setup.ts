import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { useDockerContextHost } from "./docker-host.js";
import { POSTGRES_IMAGE } from "./images.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Superuser URL of the run's Postgres container; tests create their own database from it. */
    postgresAdminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/** Starts one Postgres container for the whole `pnpm test:int` run (WP-3 decision H). */
export async function setup(project: TestProject): Promise<void> {
  useDockerContextHost();
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  project.provide("postgresAdminUrl", container.getConnectionUri());
}

/** Stops the container; Ryuk removes it too if the run crashes. */
export async function teardown(): Promise<void> {
  await container?.stop();
}
