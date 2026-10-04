-- Outbox and inbox of one service (ADR-012, WP-5 decisions S1, L1, I1). Each service runs this in
-- its own database; no table is ever shared between services. Idempotent: safe to run on every
-- migrate. WP-10 adopts it as the first migration of each service's Drizzle setup.
CREATE SCHEMA IF NOT EXISTS messaging;

-- One row per event to publish, inserted in the same transaction as the state change.
CREATE TABLE IF NOT EXISTS messaging.outbox (
  id               uuid        PRIMARY KEY,          -- the CloudEvents id
  type             text        NOT NULL,             -- dev.jadero.<context>.<event>.v<N>
  routing_key      text        NOT NULL,             -- <context>.<event>.v<N>
  envelope         jsonb       NOT NULL,             -- the whole envelope, exactly what goes on the wire
  created_at       timestamptz NOT NULL DEFAULT now(),
  attempts         integer     NOT NULL DEFAULT 0,   -- failed publish attempts
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,                             -- error class and code only, never a message
  published_at     timestamptz
);

-- Keeps the relay's poll cheap: only unsent rows are indexed.
CREATE INDEX IF NOT EXISTS outbox_unsent ON messaging.outbox (next_attempt_at) WHERE published_at IS NULL;

-- One row per event a consumer has applied, inserted in the same transaction as its effects.
CREATE TABLE IF NOT EXISTS messaging.inbox (
  consumer     text        NOT NULL,                 -- the consumer queue, e.g. agent.system.ping
  event_id     uuid        NOT NULL,
  type         text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE INDEX IF NOT EXISTS inbox_received_at ON messaging.inbox (received_at);
