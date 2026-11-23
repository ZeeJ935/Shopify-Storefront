CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_id" bigint,
	"staff_email" text,
	"role" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"result" text NOT NULL,
	"status_code" integer,
	"request_id" text,
	"detail" jsonb,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"google_sub" text NOT NULL,
	"role_at_last_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "fulfillment_actions" ADD COLUMN "created_by_staff_id" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_staff_idx" ON "audit_log" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "fulfillment_actions" ADD CONSTRAINT "fulfillment_actions_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;