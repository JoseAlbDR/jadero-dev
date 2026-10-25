CREATE TABLE "messaging"."inbox" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pkey" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE INDEX "inbox_received_at" ON "messaging"."inbox" USING btree ("received_at");