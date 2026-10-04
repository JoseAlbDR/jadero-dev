-- agent's read model of the ping (WP-5): when the messaging path last worked, per source. A future
-- lag signal for WP-26 and the Under the hood page. Owned by agent; no other service reads it.
CREATE TABLE IF NOT EXISTS broker_heartbeat (
  source         text        PRIMARY KEY,   -- jadero/api
  last_event_id  uuid        NOT NULL,
  last_trigger   text        NOT NULL,      -- manual or heartbeat
  last_seen_at   timestamptz NOT NULL
);
