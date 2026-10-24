# Environment of agent's process types on the servers (agent, agent-consumer, agent-migrate in
# infra/compose/compose.services.yml). WP-9 step 2, ADR-043, ADR-053.
#
# Only 1Password secret references for secrets, never a value: vault `jadero-ops`, the items
# infra/compose/README.md lists, the value in the item's `password` field (letters and digits
# only). The same items feed ops.env.tpl's provisioning, so a rotation changes one item.
#
# Rendered on the server, as root, by deploy.sh right before `up`, with JADERO_ENV set to staging
# or prod: `op inject` resolves `$JADERO_ENV` inside each reference and writes
# /srv/jadero/<env>/agent.env with mode 600. Outside the references `op inject` leaves
# `${JADERO_ENV}` as it is; Compose resolves it when it reads the file as an env_file, so one
# template serves both environments (role agent_<env>, broker user agent_<env> on vhost /<env>).
# Each process type blanks in compose.services.yml what it does not read: only agent-consumer
# holds RABBITMQ_URL. PORT, SERVICE_NAME, OTEL_SERVICE_NAME and NODE_OPTIONS are per process
# type, also there. No comment here holds a secret reference.

NODE_ENV=production
LOG_LEVEL=info
# No collector runs on the servers yet (ADR-010 names otlp): no spans leave the process.
OTEL_TRACES_EXPORTER=none

# The owner role of agent_<env>.
DATABASE_URL=postgres://agent_${JADERO_ENV}:{{ op://jadero-ops/postgres-agent-$JADERO_ENV/password }}@postgres:5432/agent_${JADERO_ENV}

# agent-consumer only: its broker user on the environment's vhost (`/<env>`, written %2F<env> in
# the URL), which may read its own queues and write only to agent.retry.
RABBITMQ_URL=amqp://agent_${JADERO_ENV}:{{ op://jadero-ops/rabbitmq-agent-$JADERO_ENV/password }}@rabbitmq:5672/%2F${JADERO_ENV}

# AI providers stay fake on the servers until their WPs and the owner say otherwise (AGENTS.md
# section 7). Not read yet: the AI ports arrive with their WPs.
AI_CHAT_PROVIDER=fake
AI_GUARD_PROVIDER=fake
AI_EMBEDDINGS_PROVIDER=fake
AI_RERANK_PROVIDER=fake
