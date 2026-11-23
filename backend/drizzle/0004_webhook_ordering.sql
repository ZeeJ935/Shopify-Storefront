ALTER TABLE "webhook_events" ADD COLUMN "triggered_at" timestamp with time zone;
ALTER TABLE "webhook_events" ADD COLUMN "api_version" text;
