# Dev containers

`compose.dev.yml` runs the two dependencies the apps need on a laptop; the apps themselves run on the host with `pnpm dev`.

- Postgres 18 with pgvector on `127.0.0.1:5432`: databases `content_dev`, `agent_dev`, `contact_dev`, each owned by its own role (`content`, `agent`, `contact`) and closed to the others. Superuser `postgres`.
- RabbitMQ 4 on `127.0.0.1:5672` (AMQP) and `http://localhost:15672` (management UI), user `dev`.
- Start with `pnpm dev:up` (waits for both healthchecks), stop with `pnpm dev:down`. Connection strings for the apps are in the root `.env.example`.
- `init/01-databases.sql` runs only when the `pgdata` volume is empty. After changing it, reset the volume: `docker compose -f infra/compose/compose.dev.yml down -v`, then `pnpm dev:up`. This deletes all local data.
- All passwords here are fixed dev values for local use only; ports bind to `127.0.0.1`, so nothing is reachable from the network.

If RabbitMQ fails with `Error when reading /var/lib/rabbitmq/.erlang.cookie: eacces`, an older start left a root-owned cookie in the anonymous volume: `docker compose -f infra/compose/compose.dev.yml down -v`, then `pnpm dev:up`.
