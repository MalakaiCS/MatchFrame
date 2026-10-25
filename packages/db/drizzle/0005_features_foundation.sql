CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"location" text,
	"bytes" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"customer_id" text,
	"subscription_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"current_period_end" timestamp with time zone,
	"last_event_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_runs" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"speed" integer DEFAULT 1 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_airtime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"cue_id" text NOT NULL,
	"template_key" text NOT NULL,
	"layer" text NOT NULL,
	"source" text NOT NULL,
	"sponsor_creative_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graphic_airtime_cue" UNIQUE("overlay_id","cue_id","started_at")
);
--> statement-breakpoint
CREATE TABLE "match_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"at_label" text,
	"body" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"author_user_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_reminders_once" UNIQUE("match_id","kind")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "competitions" DROP CONSTRAINT "competitions_sport_chk";--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "standings_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "attendance" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "weather" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "officials" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "branding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "require_two_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "overlays" ADD COLUMN "format" text DEFAULT '16:9' NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "rolled_from_season_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "default_lineup" jsonb;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_runs" ADD CONSTRAINT "demo_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_runs" ADD CONSTRAINT "demo_runs_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_airtime" ADD CONSTRAINT "graphic_airtime_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_airtime" ADD CONSTRAINT "graphic_airtime_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_notes" ADD CONSTRAINT "match_notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_notes" ADD CONSTRAINT "match_notes_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reminders" ADD CONSTRAINT "match_reminders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reminders" ADD CONSTRAINT "match_reminders_match_id_organisation_id_matches_id_organisation_id_fk" FOREIGN KEY ("match_id","organisation_id") REFERENCES "public"."matches"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_runs_due_idx" ON "demo_runs" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "graphic_airtime_match_idx" ON "graphic_airtime" USING btree ("match_id","started_at");--> statement-breakpoint
CREATE INDEX "match_notes_match_idx" ON "match_notes" USING btree ("match_id","position");--> statement-breakpoint
CREATE INDEX "push_subs_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_public_token_unique" UNIQUE("public_token");--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_custom_domain_unique" UNIQUE("custom_domain");--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_chk" CHECK ("competitions"."sport" in ('football','basketball','netball','rugby_league','afl','hockey'));--> statement-breakpoint
ALTER TABLE "match_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_notes" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "push_subscriptions" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "match_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_reminders" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "graphic_airtime" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "graphic_airtime" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "graphic_airtime" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "demo_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "demo_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "demo_runs" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "billing_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "billing_accounts" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
REVOKE ALL ON "backup_runs" FROM bs_app;
