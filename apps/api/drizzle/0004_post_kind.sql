ALTER TABLE "content"."posts" ADD COLUMN "kind" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."posts" ADD COLUMN "wp" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_journal_wp_unique" ON "content"."posts" USING btree ("wp") WHERE "content"."posts"."kind" = 'journal';--> statement-breakpoint
ALTER TABLE "content"."posts" ADD CONSTRAINT "posts_kind_check" CHECK ("content"."posts"."kind" IN ('post', 'journal'));--> statement-breakpoint
ALTER TABLE "content"."posts" ADD CONSTRAINT "posts_journal_wp_check" CHECK (("content"."posts"."kind" = 'journal') = ("content"."posts"."wp" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "content"."posts" ADD CONSTRAINT "posts_wp_check" CHECK ("content"."posts"."wp" >= 1);