#!/usr/bin/env bash
# Dev only: provisions the local Postgres with infra/postgres/provision.sql and env=dev, the same
# convergent script the servers and the integration tests run (WP-8 D4).
#
# The image's entrypoint runs this file once, on an empty data volume, as the postgres user over
# the Unix socket. Because the script is convergent, it can also run on an existing volume after
# provision.sql changes, with no reset: `pnpm dev:provision`.
#
# The passwords are fixed dev values (each the role's own name), for a container bound to
# 127.0.0.1; they are not secrets and never used anywhere else. They reach psql through its
# environment, as on the servers, never through argv.
set -euo pipefail

export CONTENT_DB_PASSWORD=content_dev
export CONTENT_READER_DB_PASSWORD=content_reader_dev
export AGENT_DB_PASSWORD=agent_dev
export CONTACT_DB_PASSWORD=contact_dev

psql --no-psqlrc --quiet --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  --set env=dev --file /jadero/provision.sql
