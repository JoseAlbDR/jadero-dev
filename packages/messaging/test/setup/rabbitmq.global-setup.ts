import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { useDockerContextHost } from "./docker-host.js";
import { RABBITMQ_IMAGE } from "./images.js";
import { TEST_DEFINITIONS, TEST_VHOST } from "./test-topology.js";

declare module "vitest" {
  export interface ProvidedContext {
    serviceUri: string;
    adminUri: string;
  }
}

let container: StartedTestContainer | undefined;

/**
 * Starts one RabbitMQ container per `pnpm test:int` run, loaded with the test definitions the
 * same way compose loads the dev ones (`load_definitions`), and hands the URIs to the tests.
 * @param project the Vitest project, to provide the URIs.
 */
export async function setup(project: TestProject): Promise<void> {
  useDockerContextHost();
  container = await new GenericContainer(RABBITMQ_IMAGE)
    .withCopyContentToContainer([
      { content: JSON.stringify(TEST_DEFINITIONS), target: "/etc/rabbitmq/definitions.json" },
      {
        content: "load_definitions = /etc/rabbitmq/definitions.json\n",
        target: "/etc/rabbitmq/conf.d/20-jadero.conf",
      },
    ])
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .withStartupTimeout(120_000)
    .start();
  const base = `${container.getHost()}:${container.getMappedPort(5672)}/${TEST_VHOST}`;
  project.provide("serviceUri", `amqp://test:test@${base}`);
  project.provide("adminUri", `amqp://admin:admin@${base}`);
}

/** Stops the container. */
export async function teardown(): Promise<void> {
  await container?.stop();
}
