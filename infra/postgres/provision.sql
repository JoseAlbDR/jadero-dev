-- Convergent Postgres provisioning for every environment (WP-8 D4, ADR-027, ADR-029, ADR-050).
--
-- Run as the superuser with psql, on every deploy and as often as you like: each run lands the
-- cluster in the same state, whatever state it starts from. A role or database is created only
-- when missing, and everything else (role attributes, passwords, owners, grants, the read-only
-- default, the extension) is set again on every run, so a password rotation is a re-run.
--
--   psql -v env=<dev|staging|prod|ops> [-v service=<api|agent|contact>] -f provision.sql
--                                                             (as the superuser, over the socket)
--
-- `env` picks what the run converges:
--   dev, staging, prod   one database and one login role per service, both named <service>_<env>
--                        (content, agent, contact), plus api's read-only content_reader_<env>.
--   ops                  only the `umami` role and database of the ops stack (jadero_ops network).
-- The ops stack has its own value, not a side effect of prod or staging, so the deploy of one
-- environment needs only that environment's passwords (least privilege for the deploy's secrets).
--
-- `service` (optional, dev, staging and prod only) narrows the run to one service's roles and
-- database: api converges content_<env> and content_reader_<env>, agent converges agent_<env>
-- (and pgvector), contact converges contact_<env>. Without it the run converges every service,
-- as dev and the integration tests do. A deploy passes its own service (WP-9 D4, rotation
-- ordering): a password is checked only when a connection opens and a service reads its env file
-- only at boot, so a deploy of api must never re-password agent's role behind agent's back, and it
-- needs only api's passwords, taken from the env file it just rendered.
--
-- Passwords come from the environment of the psql process, never from its argv (`ps` shows argv):
--   dev, staging, prod   CONTENT_DB_PASSWORD, CONTENT_READER_DB_PASSWORD, AGENT_DB_PASSWORD,
--                        CONTACT_DB_PASSWORD (with `service`, only that service's ones)
--   ops                  UMAMI_DB_PASSWORD
-- A missing or empty one stops the run before any change, naming the variable, never its value.
--
-- Not one transaction: CREATE DATABASE cannot run inside one. A run that stops halfway leaves a
-- partial state that the next run completes, which is what convergent means here.
--
-- The dev container runs this file on its first boot (infra/compose/init/01-provision.sh), and
-- @jadero/testing runs it in every integration test container: one script for dev, tests and
-- servers, so the extension list and the roles have one source.

-- Stop at the first error, and keep statement text out of psql's error output: on a failing
-- statement the default verbosity prints the line it failed on, which could hold a password.
\set ON_ERROR_STOP on
\set VERBOSITY terse
\set SHOW_CONTEXT never

-- Keep the passwords out of the server log for this session (session-level, superuser only):
-- no statement is logged as such, by duration, or as the statement behind an error.
SET log_statement = none;
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
-- The "already a member" notices of a re-run are noise.
SET client_min_messages = warning;

\if :{?env}
\else
  \warn 'provision.sql: set the environment with -v env=<dev|staging|prod|ops>'
  DO $$ BEGIN RAISE EXCEPTION 'provision.sql: env is not set'; END $$;
\endif

SELECT :'env' IN ('dev', 'staging', 'prod') AS service_env, :'env' = 'ops' AS ops_env \gset

-- Which services this run converges: every one without `service`, else the one named.
\if :{?service}
\else
  \set service all
\endif
SELECT :'service' IN ('all', 'api', 'agent', 'contact') AS service_known,
  :'service' IN ('all', 'api') AS do_content,
  :'service' IN ('all', 'agent') AS do_agent,
  :'service' IN ('all', 'contact') AS do_contact \gset
\if :service_known
\else
  \warn 'provision.sql: service must be api, agent or contact, got' :service
  DO $$ BEGIN RAISE EXCEPTION 'provision.sql: unknown service'; END $$;
\endif

\if :service_env
  -- Role and database names carry the environment, because roles are cluster-wide and staging
  -- and production share one Postgres (D4). The owner role and its database share the name.
  \set content_role content_:env
  \set content_reader_role content_reader_:env
  \set agent_role agent_:env
  \set contact_role contact_:env

  \getenv content_password CONTENT_DB_PASSWORD
  \getenv content_reader_password CONTENT_READER_DB_PASSWORD
  \getenv agent_password AGENT_DB_PASSWORD
  \getenv contact_password CONTACT_DB_PASSWORD
  \if :{?content_password}
  \else
    \set content_password ''
  \endif
  \if :{?content_reader_password}
  \else
    \set content_reader_password ''
  \endif
  \if :{?agent_password}
  \else
    \set agent_password ''
  \endif
  \if :{?contact_password}
  \else
    \set contact_password ''
  \endif

  -- The names of the missing variables, or no variable at all when none is missing.
  SELECT string_agg(name, ', ' ORDER BY position) AS missing_passwords
  FROM (VALUES
    (1, 'CONTENT_DB_PASSWORD', :'content_password', :'do_content'::boolean),
    (2, 'CONTENT_READER_DB_PASSWORD', :'content_reader_password', :'do_content'::boolean),
    (3, 'AGENT_DB_PASSWORD', :'agent_password', :'do_agent'::boolean),
    (4, 'CONTACT_DB_PASSWORD', :'contact_password', :'do_contact'::boolean)
  ) AS passwords (position, name, value, needed)
  WHERE needed AND value = ''
  \gset
  \if :{?missing_passwords}
    \warn 'provision.sql: missing or empty:' :missing_passwords
    DO $$ BEGIN RAISE EXCEPTION 'provision.sql: a password variable is missing or empty'; END $$;
  \endif

  -- Login roles of the services this run converges: created only when missing, then every
  -- attribute and the password set again.
  SELECT format('CREATE ROLE %I', name)
  FROM (VALUES
    (:'content_role', :'do_content'::boolean),
    (:'content_reader_role', :'do_content'::boolean),
    (:'agent_role', :'do_agent'::boolean),
    (:'contact_role', :'do_contact'::boolean)
  ) AS wanted (name, needed)
  WHERE needed AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = wanted.name)
  \gexec

  -- One database per service, owned by its role and closed to PUBLIC: a role can connect only to
  -- the database it owns or is granted, so agent_<env> cannot open content_<env> (ADR-029).
  SELECT format('CREATE DATABASE %I OWNER %I', name, name)
  FROM (VALUES
    (:'content_role', :'do_content'::boolean),
    (:'agent_role', :'do_agent'::boolean),
    (:'contact_role', :'do_contact'::boolean)
  ) AS wanted (name, needed)
  WHERE needed AND NOT EXISTS (SELECT FROM pg_database WHERE datname = wanted.name)
  \gexec

  \if :do_content
    ALTER ROLE :"content_role" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'content_password';
    ALTER ROLE :"content_reader_role" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'content_reader_password';
    ALTER DATABASE :"content_role" OWNER TO :"content_role";
    REVOKE CONNECT ON DATABASE :"content_role" FROM PUBLIC;

    -- api's read-only reader (WP-12 step 7), as a group role and a login role per environment.
    -- api's applied migration 0002_content_reader asserts a role named exactly `content_reader` and
    -- grants it SELECT table by table, and an applied migration never changes. So `content_reader`
    -- is a cluster-wide group that cannot log in and holds the grants, and content_reader_<env> is
    -- the login role: a member that inherits them, read-only by default, with CONNECT on its own
    -- environment's content database only.
    -- Accepted cost: the grants live on the group, and the group is shared by both environments, so
    -- content_reader_staging inherits SELECT on content_prod's tables too. It cannot use it: it has
    -- no CONNECT on content_prod (only content_reader_prod has), and pg_hba.conf accepts it only
    -- from the staging network, on content_staging only (infra/postgres/pg_hba.conf).
    SELECT 'CREATE ROLE content_reader'
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'content_reader')
    \gexec
    ALTER ROLE content_reader WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT content_reader TO :"content_reader_role" WITH INHERIT TRUE;
    ALTER ROLE :"content_reader_role" SET default_transaction_read_only = on;
    GRANT CONNECT ON DATABASE :"content_role" TO :"content_reader_role";
  \endif

  \if :do_contact
    ALTER ROLE :"contact_role" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'contact_password';
    ALTER DATABASE :"contact_role" OWNER TO :"contact_role";
    REVOKE CONNECT ON DATABASE :"contact_role" FROM PUBLIC;
  \endif

  \if :do_agent
    ALTER ROLE :"agent_role" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'agent_password';
    ALTER DATABASE :"agent_role" OWNER TO :"agent_role";
    REVOKE CONNECT ON DATABASE :"agent_role" FROM PUBLIC;
    -- pgvector only where embeddings live (ADR-027). An extension that is not trusted needs the
    -- superuser, hence here; agent's first migration only asserts it. Last on purpose: \connect
    -- opens a new session, without the session settings above, and nothing after it holds a password.
    \connect :agent_role
    SET client_min_messages = warning;
    CREATE EXTENSION IF NOT EXISTS vector;
  \endif
\elif :ops_env
  SELECT :'service' <> 'all' AS service_on_ops \gset
  \if :service_on_ops
    \warn 'provision.sql: service applies to dev, staging and prod only'
    DO $$ BEGIN RAISE EXCEPTION 'provision.sql: service set with env=ops'; END $$;
  \endif
  \getenv umami_password UMAMI_DB_PASSWORD
  \if :{?umami_password}
  \else
    \set umami_password ''
  \endif
  SELECT :'umami_password' = '' AS umami_password_missing \gset
  \if :umami_password_missing
    \warn 'provision.sql: missing or empty: UMAMI_DB_PASSWORD'
    DO $$ BEGIN RAISE EXCEPTION 'provision.sql: a password variable is missing or empty'; END $$;
  \endif

  -- Umami's own role and database (one instance on the server, not per environment).
  SELECT 'CREATE ROLE umami'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umami')
  \gexec
  ALTER ROLE umami WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'umami_password';
  SELECT 'CREATE DATABASE umami OWNER umami'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami')
  \gexec
  ALTER DATABASE umami OWNER TO umami;
  REVOKE CONNECT ON DATABASE umami FROM PUBLIC;
\else
  \warn 'provision.sql: env must be dev, staging, prod or ops, got' :env
  DO $$ BEGIN RAISE EXCEPTION 'provision.sql: unknown env'; END $$;
\endif
