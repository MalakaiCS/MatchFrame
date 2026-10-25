-- Stream links: one OBS link for a day of back-to-back matches at a ground or in a competition.
CREATE TABLE "stream_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"venue_id" uuid,
	"competition_id" uuid,
	"public_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"pinned_match_id" uuid,
	"switch_before_minutes" integer DEFAULT 10 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_channels_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "stream_channels_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "stream_channels" ADD CONSTRAINT "stream_channels_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_channels" ADD CONSTRAINT "stream_channels_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_channels" ADD CONSTRAINT "stream_channels_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_channels" ADD CONSTRAINT "stream_channels_pinned_match_id_matches_id_fk" FOREIGN KEY ("pinned_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stream_channels_org_idx" ON "stream_channels" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "stream_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stream_channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stream_channels" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
--> statement-breakpoint
-- the OBS page has only the link's token: find its organisation and link without a tenant (like overlay credentials)
CREATE OR REPLACE FUNCTION resolve_stream_channel(p_hash text)
RETURNS TABLE(organisation_id uuid, id uuid, token_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organisation_id, c.id, c.token_version FROM stream_channels c WHERE c.token_hash = p_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_stream_channel(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_stream_channel(text) TO bs_app, bs_worker;
