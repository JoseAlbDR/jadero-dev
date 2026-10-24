CREATE TABLE "content"."now" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."now_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"now_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "now_revisions_number_unique" UNIQUE("now_id","locale","number"),
	CONSTRAINT "now_revisions_pointer_target" UNIQUE("now_id","locale","id"),
	CONSTRAINT "now_revisions_locale_check" CHECK ("content"."now_revisions"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "now_revisions_origin_check" CHECK ("content"."now_revisions"."origin" IN ('owner', 'machine')),
	CONSTRAINT "now_revisions_number_check" CHECK ("content"."now_revisions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."now_translations" (
	"now_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"latest_revision_id" uuid NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "now_translations_pkey" PRIMARY KEY("now_id","locale"),
	CONSTRAINT "now_translations_locale_check" CHECK ("content"."now_translations"."locale" IN ('es', 'en', 'de')),
	CONSTRAINT "now_translations_published_check" CHECK (num_nulls("content"."now_translations"."published_revision_id", "content"."now_translations"."published_at", "content"."now_translations"."first_published_at") IN (0, 3))
);
--> statement-breakpoint
ALTER TABLE "content"."now_revisions" ADD CONSTRAINT "now_revisions_item_fk" FOREIGN KEY ("now_id") REFERENCES "content"."now"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."now_translations" ADD CONSTRAINT "now_translations_item_fk" FOREIGN KEY ("now_id") REFERENCES "content"."now"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."now_translations" ADD CONSTRAINT "now_translations_latest_fk" FOREIGN KEY ("now_id","locale","latest_revision_id") REFERENCES "content"."now_revisions"("now_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."now_translations" ADD CONSTRAINT "now_translations_published_fk" FOREIGN KEY ("now_id","locale","published_revision_id") REFERENCES "content"."now_revisions"("now_id","locale","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "now_singleton" ON "content"."now" USING btree ((true));--> statement-breakpoint
-- WP-39 D2: the public read of /now runs as content_reader, which 0002 grants table by table with
-- no default privileges, so the new tables stay unreadable until granted here. The two tables the
-- query reads, never the root row (like the profile). A missing role fails the batch (42704).
GRANT SELECT ON TABLE content.now_translations, content.now_revisions TO content_reader;
