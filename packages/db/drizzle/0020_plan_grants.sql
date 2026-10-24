ALTER TABLE "billing_accounts" ADD COLUMN "interval" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "grant_plan" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "grant_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "granted_by" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "grant_reason" text;--> statement-breakpoint
-- the worker looks for plans given by staff whose time is up
CREATE INDEX "billing_accounts_grant_ends_idx" ON "billing_accounts" USING btree ("grant_ends_at") WHERE "grant_plan" IS NOT NULL;--> statement-breakpoint
-- site staff see every organisation's plan, and when a plan they gave ends, in the console (read only)
CREATE POLICY staff_read ON billing_accounts FOR SELECT TO bs_app USING ((SELECT app_staff_role(app_current_user())) IS NOT NULL);
