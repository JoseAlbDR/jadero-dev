# Secrets of the server's ops stack (infra/compose/compose.ops.yml) and of its provisioning runs
# (infra/postgres/provision.sql, infra/rabbitmq/provision-users.sh). WP-8 D5, ADR-043.
#
# Only 1Password secret references, never a value: vault `jadero-ops`, one item per secret, the
# value in the item's `password` field. The item names are listed in infra/compose/README.md.
# Every generated value is letters and digits only (no symbols): a value is read by a shell
# (`set -a; . ops.env`), by Compose interpolation and inside a connection URL, and each of them
# treats some symbol specially.
#
# Rendered on the server, as root, never on a laptop and never into the repo:
#
#   OP_SERVICE_ACCOUNT_TOKEN="$(cat /etc/jadero/op-token)" \
#     op inject --force -i infra/env/ops.env.tpl -o /srv/jadero/ops/ops.env
#
# The token file is root's, mode 600, read only for this one call (the token is in op's
# environment, never in its argv). `op inject` writes the output with mode 600; the file stays
# root's, read by `docker compose --env-file` and by the provisioning commands.
#
# Postgres and RabbitMQ role passwords carry their environment in the variable name, because
# staging and production share one server; the provisioning commands map them to the names
# provision.sql reads (CONTENT_DB_PASSWORD, ...). The same items feed the services' own
# templates (WP-9), so a rotation changes one item.

# Postgres superuser: needed by initdb on an empty volume, never used to log in (peer only).
POSTGRES_PASSWORD={{ op://jadero-ops/postgres-superuser/password }}

# Production roles (provision.sql -v env=prod).
PROD_CONTENT_DB_PASSWORD={{ op://jadero-ops/postgres-content-prod/password }}
PROD_CONTENT_READER_DB_PASSWORD={{ op://jadero-ops/postgres-content-reader-prod/password }}
PROD_AGENT_DB_PASSWORD={{ op://jadero-ops/postgres-agent-prod/password }}
PROD_CONTACT_DB_PASSWORD={{ op://jadero-ops/postgres-contact-prod/password }}

# Staging roles (provision.sql -v env=staging).
STAGING_CONTENT_DB_PASSWORD={{ op://jadero-ops/postgres-content-staging/password }}
STAGING_CONTENT_READER_DB_PASSWORD={{ op://jadero-ops/postgres-content-reader-staging/password }}
STAGING_AGENT_DB_PASSWORD={{ op://jadero-ops/postgres-agent-staging/password }}
STAGING_CONTACT_DB_PASSWORD={{ op://jadero-ops/postgres-contact-staging/password }}

# Umami's role (provision.sql -v env=ops) and the URL Umami connects with, from the same item.
UMAMI_DB_PASSWORD={{ op://jadero-ops/postgres-umami/password }}
UMAMI_DATABASE_URL=postgresql://umami:{{ op://jadero-ops/postgres-umami/password }}@postgres:5432/umami
# Umami's session signing secret.
UMAMI_APP_SECRET={{ op://jadero-ops/umami-app-secret/password }}

# RabbitMQ users (provision-users.sh reads these names as they are).
RABBITMQ_API_PROD_PASSWORD={{ op://jadero-ops/rabbitmq-api-prod/password }}
RABBITMQ_AGENT_PROD_PASSWORD={{ op://jadero-ops/rabbitmq-agent-prod/password }}
RABBITMQ_API_STAGING_PASSWORD={{ op://jadero-ops/rabbitmq-api-staging/password }}
RABBITMQ_AGENT_STAGING_PASSWORD={{ op://jadero-ops/rabbitmq-agent-staging/password }}
RABBITMQ_OPS_ADMIN_PASSWORD={{ op://jadero-ops/rabbitmq-ops-admin/password }}
