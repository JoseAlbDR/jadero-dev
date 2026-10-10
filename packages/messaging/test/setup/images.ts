/**
 * The RabbitMQ image of the integration tests; a unit test keeps it equal to compose.dev.yml. The
 * Postgres image is `POSTGRES_IMAGE` from `@jadero/testing`, which checks its own tag.
 */
export const RABBITMQ_IMAGE = "rabbitmq:4.3.6-management-alpine";
