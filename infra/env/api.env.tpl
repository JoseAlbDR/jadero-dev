# Environment of api's process types on the servers (api, api-worker, api-migrate in
# infra/compose/compose.services.yml). WP-9 step 2, ADR-043, ADR-053.
#
# Only 1Password secret references for secrets, never a value: vault `jadero-ops`, the items
# infra/compose/README.md lists, one per role or broker user and environment, the value in the
# item's `password` field (letters and digits only). The same items feed ops.env.tpl's
# provisioning, so a rotation changes one item.
#
# Rendered on the server, as root, by deploy.sh right before `up`, with JADERO_ENV set to staging
# or prod: `op inject` resolves `$JADERO_ENV` inside each reference and writes
# /srv/jadero/<env>/api.env with mode 600. Outside the references `op inject` leaves
# `${JADERO_ENV}` as it is; Compose resolves it when it reads the file as an env_file, so one
# template serves both environments (roles content_<env>, broker user api_<env> on vhost /<env>).
# Each process type blanks in compose.services.yml what it does not read: api-worker never holds
# DATABASE_READ_URL, api never holds RABBITMQ_URL. PORT, SERVICE_NAME, OTEL_SERVICE_NAME and
# NODE_OPTIONS are per process type, also there. No comment here holds a secret reference.

NODE_ENV=production
LOG_LEVEL=info
# No collector runs on the servers yet (ADR-010 names otlp): no spans leave the process.
OTEL_TRACES_EXPORTER=none

# The owner role of content_<env> (migrations, writes, api-worker's relay).
DATABASE_URL=postgres://content_${JADERO_ENV}:{{ op://jadero-ops/postgres-content-$JADERO_ENV/password }}@postgres:5432/content_${JADERO_ENV}
# api only: the read-only role of the public content reads (WP-12 step 7).
DATABASE_READ_URL=postgres://content_reader_${JADERO_ENV}:{{ op://jadero-ops/postgres-content-reader-$JADERO_ENV/password }}@postgres:5432/content_${JADERO_ENV}

# api-worker only: its broker user on the environment's vhost (`/<env>`, written %2F<env> in the
# URL), and one ping a minute, so an agent deploy's smoke check waits at most that long.
RABBITMQ_URL=amqp://api_${JADERO_ENV}:{{ op://jadero-ops/rabbitmq-api-$JADERO_ENV/password }}@rabbitmq:5672/%2F${JADERO_ENV}
HEARTBEAT_INTERVAL_MS=60000
