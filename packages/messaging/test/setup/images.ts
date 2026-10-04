/** The RabbitMQ image of the integration tests; a unit test keeps it equal to compose.dev.yml. */
export const RABBITMQ_IMAGE = "rabbitmq:4.3.6-management-alpine";

/** The Postgres image of the integration tests; same as compose.dev.yml and apps/api. */
export const POSTGRES_IMAGE = "pgvector/pgvector:0.8.7-pg18";
