CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE TABLE "messaging"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"routing_key" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "outbox_unsent" ON "messaging"."outbox" USING btree ("next_attempt_at") WHERE "messaging"."outbox"."published_at" IS NULL;