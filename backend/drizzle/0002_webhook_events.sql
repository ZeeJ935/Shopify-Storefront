CREATE TABLE "webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"topic" text NOT NULL,
	"shop_domain" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "webhook_events_webhook_id_unique" UNIQUE("webhook_id")
);
--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("processed_at","failed_at");