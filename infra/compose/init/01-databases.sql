-- Local development only: fixed dev passwords, Postgres bound to 127.0.0.1 (compose.dev.yml).
-- One role and one database per service (ADR-029 rule 1, ADR-027). REVOKE CONNECT FROM PUBLIC
-- means a role can connect only to the database it owns, so `agent` cannot open `content_dev`.
-- The entrypoint runs this file once, as the postgres superuser, only on an empty data volume.

CREATE ROLE content LOGIN PASSWORD 'content';
CREATE DATABASE content_dev OWNER content;
REVOKE CONNECT ON DATABASE content_dev FROM PUBLIC;

-- The read-only role of api's public content reads (WP-12 step 7, least privilege): it may
-- connect to content_dev, every transaction it opens is read-only, and api's migration
-- 0002_content_reader grants it SELECT table by table (never the private entry provenance).
-- @jadero/testing reads these lines, so the integration tests create the same role.
CREATE ROLE content_reader LOGIN PASSWORD 'content_reader';
GRANT CONNECT ON DATABASE content_dev TO content_reader;
ALTER ROLE content_reader SET default_transaction_read_only = on;

CREATE ROLE agent LOGIN PASSWORD 'agent';
CREATE DATABASE agent_dev OWNER agent;
REVOKE CONNECT ON DATABASE agent_dev FROM PUBLIC;

CREATE ROLE contact LOGIN PASSWORD 'contact';
CREATE DATABASE contact_dev OWNER contact;
REVOKE CONNECT ON DATABASE contact_dev FROM PUBLIC;

-- pgvector only where embeddings live (ADR-027). Creating an extension needs a superuser, hence here.
\connect agent_dev
CREATE EXTENSION IF NOT EXISTS vector;
