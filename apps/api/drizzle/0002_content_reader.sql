-- WP-12 step 7a: what the read-only role `content_reader` may read (least privilege, deny by
-- default). The public content reads of api connect as this role (DATABASE_READ_URL); writes keep
-- the owner role (DATABASE_URL). Provisioning creates the role, its CONNECT and its read-only
-- default (infra/compose/init/01-databases.sql in dev, WP-8 on the servers); this migration only
-- grants, as the owner of the `content` schema, and fails loudly when the role is missing.
-- SELECT is granted table by table, on exactly the tables the query service reads: never on
-- `knowledge_entry_provenance` (D-67), the outbox or the migration journal, and no ALTER DEFAULT
-- PRIVILEGES, so a table added later stays unreadable until a migration grants it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'content_reader') THEN
    RAISE EXCEPTION 'role content_reader does not exist: provisioning creates it (infra/compose/init/01-databases.sql)';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA content TO content_reader;
--> statement-breakpoint
GRANT SELECT ON TABLE
  content.profile_translations,
  content.profile_revisions,
  content.experience_items,
  content.experience_item_translations,
  content.experience_item_revisions,
  content.cv_bullets,
  content.cv_bullet_translations,
  content.cv_bullet_revisions,
  content.projects,
  content.project_translations,
  content.project_revisions,
  content.posts,
  content.post_translations,
  content.post_revisions,
  content.skills,
  content.skill_translations,
  content.skill_revisions,
  content.knowledge_entries,
  content.knowledge_entry_revisions
TO content_reader;
