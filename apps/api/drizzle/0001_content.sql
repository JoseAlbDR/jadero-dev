CREATE SCHEMA "content";
--> statement-breakpoint
CREATE TABLE "content"."cv_bullet_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cv_bullet_id" text NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cv_bullet_revisions_number_unique" UNIQUE("cv_bullet_id","locale","number"),
	CONSTRAINT "cv_bullet_revisions_pointer_target" UNIQUE("cv_bullet_id","locale","id"),
	CONSTRAINT "cv_bullet_revisions_locale_check" CHECK ("content"."cv_bullet_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "cv_bullet_revisions_origin_check" CHECK ("content"."cv_bullet_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "cv_bullet_revisions_number_check" CHECK ("content"."cv_bullet_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."cv_bullet_translations" (
	"cv_bullet_id" text NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "cv_bullet_translations_pkey" PRIMARY KEY("cv_bullet_id","locale"),
	CONSTRAINT "cv_bullet_translations_locale_check" CHECK ("content"."cv_bullet_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "cv_bullet_translations_published_check" CHECK (num_nulls("content"."cv_bullet_translations"."published_revision_id", "content"."cv_bullet_translations"."published_at", "content"."cv_bullet_translations"."first_published_at") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "content"."cv_bullets" (
	"id" text PRIMARY KEY NOT NULL,
	"experience_item_id" uuid,
	"project_id" uuid,
	"sort_order" integer NOT NULL,
	"importance" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "cv_bullets_one_parent_check" CHECK (num_nonnulls("content"."cv_bullets"."experience_item_id", "content"."cv_bullets"."project_id") = 1),
	CONSTRAINT "cv_bullets_importance_check" CHECK ("content"."cv_bullets"."importance" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "content"."experience_item_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"experience_item_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experience_item_revisions_number_unique" UNIQUE("experience_item_id","locale","number"),
	CONSTRAINT "experience_item_revisions_pointer_target" UNIQUE("experience_item_id","locale","id"),
	CONSTRAINT "experience_item_revisions_locale_check" CHECK ("content"."experience_item_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "experience_item_revisions_origin_check" CHECK ("content"."experience_item_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "experience_item_revisions_number_check" CHECK ("content"."experience_item_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."experience_item_translations" (
	"experience_item_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "experience_item_translations_pkey" PRIMARY KEY("experience_item_id","locale"),
	CONSTRAINT "experience_item_translations_locale_check" CHECK ("content"."experience_item_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "experience_item_translations_published_check" CHECK (num_nulls("content"."experience_item_translations"."published_revision_id", "content"."experience_item_translations"."published_at", "content"."experience_item_translations"."first_published_at") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "content"."experience_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."post_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_revisions_number_unique" UNIQUE("post_id","locale","number"),
	CONSTRAINT "post_revisions_pointer_target" UNIQUE("post_id","locale","id"),
	CONSTRAINT "post_revisions_locale_check" CHECK ("content"."post_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "post_revisions_origin_check" CHECK ("content"."post_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "post_revisions_number_check" CHECK ("content"."post_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."post_translations" (
	"post_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"published_slug" text,
	CONSTRAINT "post_translations_pkey" PRIMARY KEY("post_id","locale"),
	CONSTRAINT "post_translations_slug_unique" UNIQUE("locale","published_slug"),
	CONSTRAINT "post_translations_locale_check" CHECK ("content"."post_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "post_translations_published_check" CHECK (num_nulls("content"."post_translations"."published_revision_id", "content"."post_translations"."published_at", "content"."post_translations"."first_published_at") IN (0, 3)),
	CONSTRAINT "post_translations_slug_check" CHECK (("content"."post_translations"."published_slug" IS NULL) = ("content"."post_translations"."published_revision_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "content"."posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "content"."profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."profile_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_revisions_number_unique" UNIQUE("profile_id","locale","number"),
	CONSTRAINT "profile_revisions_pointer_target" UNIQUE("profile_id","locale","id"),
	CONSTRAINT "profile_revisions_locale_check" CHECK ("content"."profile_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "profile_revisions_origin_check" CHECK ("content"."profile_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "profile_revisions_number_check" CHECK ("content"."profile_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."profile_translations" (
	"profile_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "profile_translations_pkey" PRIMARY KEY("profile_id","locale"),
	CONSTRAINT "profile_translations_locale_check" CHECK ("content"."profile_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "profile_translations_published_check" CHECK (num_nulls("content"."profile_translations"."published_revision_id", "content"."profile_translations"."published_at", "content"."profile_translations"."first_published_at") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "content"."project_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_revisions_number_unique" UNIQUE("project_id","locale","number"),
	CONSTRAINT "project_revisions_pointer_target" UNIQUE("project_id","locale","id"),
	CONSTRAINT "project_revisions_locale_check" CHECK ("content"."project_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "project_revisions_origin_check" CHECK ("content"."project_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "project_revisions_number_check" CHECK ("content"."project_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."project_translations" (
	"project_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"published_slug" text,
	CONSTRAINT "project_translations_pkey" PRIMARY KEY("project_id","locale"),
	CONSTRAINT "project_translations_slug_unique" UNIQUE("locale","published_slug"),
	CONSTRAINT "project_translations_locale_check" CHECK ("content"."project_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "project_translations_published_check" CHECK (num_nulls("content"."project_translations"."published_revision_id", "content"."project_translations"."published_at", "content"."project_translations"."first_published_at") IN (0, 3)),
	CONSTRAINT "project_translations_slug_check" CHECK (("content"."project_translations"."published_slug" IS NULL) = ("content"."project_translations"."published_revision_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "content"."projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"featured" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_kind_check" CHECK ("content"."projects"."kind" IN ('case_study', 'project', 'early'))
);
--> statement-breakpoint
CREATE TABLE "content"."skill_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_revisions_number_unique" UNIQUE("skill_id","locale","number"),
	CONSTRAINT "skill_revisions_pointer_target" UNIQUE("skill_id","locale","id"),
	CONSTRAINT "skill_revisions_locale_check" CHECK ("content"."skill_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "skill_revisions_origin_check" CHECK ("content"."skill_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "skill_revisions_number_check" CHECK ("content"."skill_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."skill_translations" (
	"skill_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "skill_translations_pkey" PRIMARY KEY("skill_id","locale"),
	CONSTRAINT "skill_translations_locale_check" CHECK ("content"."skill_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "skill_translations_published_check" CHECK (num_nulls("content"."skill_translations"."published_revision_id", "content"."skill_translations"."published_at", "content"."skill_translations"."first_published_at") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "content"."skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."knowledge_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"approved_revision_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_checklist" jsonb,
	"cv_bullet" text,
	"withdrawn_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "knowledge_entries_state_check" CHECK ("content"."knowledge_entries"."state" IN ('draft', 'in_review', 'approved', 'withdrawn')),
	CONSTRAINT "knowledge_entries_approval_check" CHECK (num_nulls("content"."knowledge_entries"."approved_revision_id", "content"."knowledge_entries"."approved_at", "content"."knowledge_entries"."approval_checklist") IN (0, 3)),
	CONSTRAINT "knowledge_entries_approved_state_check" CHECK ("content"."knowledge_entries"."state" <> 'approved' OR "content"."knowledge_entries"."approved_revision_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "content"."knowledge_entry_provenance" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"sources" text[] NOT NULL,
	"conflicts" text NOT NULL,
	"public_names" text[] NOT NULL,
	"confidence" text NOT NULL,
	CONSTRAINT "knowledge_entry_provenance_confidence_check" CHECK ("content"."knowledge_entry_provenance"."confidence" IN ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "content"."knowledge_entry_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_entry_revisions_number_unique" UNIQUE("entry_id","number"),
	CONSTRAINT "knowledge_entry_revisions_pointer_target" UNIQUE("entry_id","id"),
	CONSTRAINT "knowledge_entry_revisions_origin_check" CHECK ("content"."knowledge_entry_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "knowledge_entry_revisions_number_check" CHECK ("content"."knowledge_entry_revisions"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "content"."cv_bullet_revisions" ADD CONSTRAINT "cv_bullet_revisions_item_fk" FOREIGN KEY ("cv_bullet_id") REFERENCES "content"."cv_bullets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."cv_bullet_translations" ADD CONSTRAINT "cv_bullet_translations_item_fk" FOREIGN KEY ("cv_bullet_id") REFERENCES "content"."cv_bullets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."cv_bullet_translations" ADD CONSTRAINT "cv_bullet_translations_latest_fk" FOREIGN KEY ("cv_bullet_id","locale","latest_revision_id") REFERENCES "content"."cv_bullet_revisions"("cv_bullet_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."cv_bullet_translations" ADD CONSTRAINT "cv_bullet_translations_published_fk" FOREIGN KEY ("cv_bullet_id","locale","published_revision_id") REFERENCES "content"."cv_bullet_revisions"("cv_bullet_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."cv_bullets" ADD CONSTRAINT "cv_bullets_experience_item_fk" FOREIGN KEY ("experience_item_id") REFERENCES "content"."experience_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."cv_bullets" ADD CONSTRAINT "cv_bullets_project_fk" FOREIGN KEY ("project_id") REFERENCES "content"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."experience_item_revisions" ADD CONSTRAINT "experience_item_revisions_item_fk" FOREIGN KEY ("experience_item_id") REFERENCES "content"."experience_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."experience_item_translations" ADD CONSTRAINT "experience_item_translations_item_fk" FOREIGN KEY ("experience_item_id") REFERENCES "content"."experience_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."experience_item_translations" ADD CONSTRAINT "experience_item_translations_latest_fk" FOREIGN KEY ("experience_item_id","locale","latest_revision_id") REFERENCES "content"."experience_item_revisions"("experience_item_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."experience_item_translations" ADD CONSTRAINT "experience_item_translations_published_fk" FOREIGN KEY ("experience_item_id","locale","published_revision_id") REFERENCES "content"."experience_item_revisions"("experience_item_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_revisions" ADD CONSTRAINT "post_revisions_item_fk" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_translations" ADD CONSTRAINT "post_translations_item_fk" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_translations" ADD CONSTRAINT "post_translations_latest_fk" FOREIGN KEY ("post_id","locale","latest_revision_id") REFERENCES "content"."post_revisions"("post_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_translations" ADD CONSTRAINT "post_translations_published_fk" FOREIGN KEY ("post_id","locale","published_revision_id") REFERENCES "content"."post_revisions"("post_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."profile_revisions" ADD CONSTRAINT "profile_revisions_item_fk" FOREIGN KEY ("profile_id") REFERENCES "content"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."profile_translations" ADD CONSTRAINT "profile_translations_item_fk" FOREIGN KEY ("profile_id") REFERENCES "content"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."profile_translations" ADD CONSTRAINT "profile_translations_latest_fk" FOREIGN KEY ("profile_id","locale","latest_revision_id") REFERENCES "content"."profile_revisions"("profile_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."profile_translations" ADD CONSTRAINT "profile_translations_published_fk" FOREIGN KEY ("profile_id","locale","published_revision_id") REFERENCES "content"."profile_revisions"("profile_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."project_revisions" ADD CONSTRAINT "project_revisions_item_fk" FOREIGN KEY ("project_id") REFERENCES "content"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."project_translations" ADD CONSTRAINT "project_translations_item_fk" FOREIGN KEY ("project_id") REFERENCES "content"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."project_translations" ADD CONSTRAINT "project_translations_latest_fk" FOREIGN KEY ("project_id","locale","latest_revision_id") REFERENCES "content"."project_revisions"("project_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."project_translations" ADD CONSTRAINT "project_translations_published_fk" FOREIGN KEY ("project_id","locale","published_revision_id") REFERENCES "content"."project_revisions"("project_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."skill_revisions" ADD CONSTRAINT "skill_revisions_item_fk" FOREIGN KEY ("skill_id") REFERENCES "content"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."skill_translations" ADD CONSTRAINT "skill_translations_item_fk" FOREIGN KEY ("skill_id") REFERENCES "content"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."skill_translations" ADD CONSTRAINT "skill_translations_latest_fk" FOREIGN KEY ("skill_id","locale","latest_revision_id") REFERENCES "content"."skill_revisions"("skill_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."skill_translations" ADD CONSTRAINT "skill_translations_published_fk" FOREIGN KEY ("skill_id","locale","published_revision_id") REFERENCES "content"."skill_revisions"("skill_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."knowledge_entries" ADD CONSTRAINT "knowledge_entries_approved_fk" FOREIGN KEY ("id","approved_revision_id") REFERENCES "content"."knowledge_entry_revisions"("entry_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."knowledge_entry_provenance" ADD CONSTRAINT "knowledge_entry_provenance_revision_fk" FOREIGN KEY ("revision_id") REFERENCES "content"."knowledge_entry_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."knowledge_entry_revisions" ADD CONSTRAINT "knowledge_entry_revisions_entry_fk" FOREIGN KEY ("entry_id") REFERENCES "content"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_bullets_experience_item_idx" ON "content"."cv_bullets" USING btree ("experience_item_id");--> statement-breakpoint
CREATE INDEX "cv_bullets_project_idx" ON "content"."cv_bullets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_singleton" ON "content"."profile" USING btree ((true));--> statement-breakpoint
CREATE INDEX "knowledge_entries_cv_bullet_idx" ON "content"."knowledge_entries" USING btree ("cv_bullet");