-- Videos of whole matches for the highlights generator (Match → Highlights), uploaded in parts.
CREATE TABLE "match_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"upload_id" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"part_size" integer NOT NULL,
	"state" text NOT NULL,
	"error" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" double precision,
	"proxy_key" text,
	"thumbnail_key" text,
	"sync" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_videos" ADD CONSTRAINT "match_videos_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_videos_match_idx" ON "match_videos" USING btree ("organisation_id","match_id");--> statement-breakpoint
ALTER TABLE "match_videos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_videos" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "match_videos" TO bs_app USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
