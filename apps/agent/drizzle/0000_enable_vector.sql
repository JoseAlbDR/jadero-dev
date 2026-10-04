-- Custom SQL migration file, put your code below! --
-- ADR-005 "extensions in the first migration", ADR-027 "vector only in agent_*". `vector` is not a
-- trusted extension, so provisioning creates it as superuser (dev init script, WP-8 elsewhere); here
-- it is a no-op where it exists and a loud "permission denied" where provisioning forgot it.
CREATE EXTENSION IF NOT EXISTS vector;
